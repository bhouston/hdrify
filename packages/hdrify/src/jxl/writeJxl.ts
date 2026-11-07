import { encodeFloat16 } from '../exr/halfFloat.js';
import { ensureNonNegativeFinite, type HdrifyImage } from '../hdrifyImage.js';
import { defaultWpHeader, WpState } from './jxlPredictors.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import {
  estimateContextBits,
  estimateStreamBits,
  JxlEncEntropyCode,
  packSigned,
  type TokenStream,
} from './jxlEncEntropy.js';
import {
  type JxlEncBitDepth,
  writeFrameHeader,
  writeImageMetadata,
  writeSizeHeader,
  writeToc,
  wrapJxlContainer,
} from './jxlEncHeaders.js';

export interface WriteJxlOptions {
  /**
   * Sample format. 'float16' (default) rounds to half floats like EXR HALF; 'float32' is
   * bit-exact; 'uint16'/'uint8' clamp to [0, 1] and quantize.
   */
  bitDepth?: 'float16' | 'float32' | 'uint16' | 'uint8';
  /** Write an alpha channel. Default: only when some alpha value is not 1. */
  alpha?: boolean;
  /** Wrap the codestream in the ISOBMFF container (default false: bare codestream). */
  container?: boolean;
  /** Replace negative and non-finite values with 0 in place first, like writeExr (default true). */
  sanitize?: boolean;
  /** Modular group size is 128 << groupSizeShift pixels (0..3, default 1 → 256). */
  groupSizeShift?: number;
}

const BIT_DEPTHS: Record<NonNullable<WriteJxlOptions['bitDepth']>, JxlEncBitDepth> = {
  float16: { float: true, bitsPerSample: 16, expBits: 5 },
  float32: { float: true, bitsPerSample: 32, expBits: 8 },
  uint16: { float: false, bitsPerSample: 16, expBits: 0 },
  uint8: { float: false, bitsPerSample: 8, expBits: 0 },
};

const PREDICTOR_GRADIENT = 5;

/**
 * Encode an image as a lossless Modular JPEG XL (prefix codes and optional LZ77,
 * per-context Gradient/Weighted predictors, YCoCg RCT and channel palettes chosen by
 * estimated size). Modelled on libjxl's enc_fast_lossless.cc.
 */
export function writeJxl(image: HdrifyImage, options: WriteJxlOptions = {}): Uint8Array {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`writeJxl: invalid dimensions ${width}x${height}`);
  }
  if (width > 2 ** 30 || height > 2 ** 30) throw new Error('writeJxl: dimensions exceed 2^30');
  if (data.length !== width * height * 4) {
    throw new Error(`writeJxl: data length ${data.length} does not match ${width}x${height} RGBA`);
  }
  const groupSizeShift = options.groupSizeShift ?? 1;
  if (!Number.isInteger(groupSizeShift) || groupSizeShift < 0 || groupSizeShift > 3) {
    throw new Error(`writeJxl: groupSizeShift must be 0..3, got ${groupSizeShift}`);
  }
  const format = options.bitDepth ?? 'float16';
  const bitDepth = BIT_DEPTHS[format];
  if (!bitDepth) throw new Error(`writeJxl: unsupported bitDepth ${format}`);
  if (options.sanitize !== false) ensureNonNegativeFinite(data);

  let hasAlpha = options.alpha;
  if (hasAlpha === undefined) {
    hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 1) {
        hasAlpha = true;
        break;
      }
    }
  }

  const numChannels = hasAlpha ? 4 : 3;
  let planes = toPlanes(data, width * height, numChannels, format);

  // Pick the cheaper of: channel palettes on the raw channels, or YCoCg RCT followed by
  // channel palettes (a cheap stand-in for libjxl's transform search).
  let plan = transformPlan(planes, width, height, false);
  const withRct = transformPlan(planes, width, height, true);
  if (withRct.estimatedBits < plan.estimatedBits) plan = withRct;
  const { transforms, metaChannels } = plan;
  planes = plan.planes;

  const groupDim = 128 << groupSizeShift;
  const groupsX = Math.ceil(width / groupDim);
  const groupsY = Math.ceil(height / groupDim);
  const singleGroup = groupsX === 1 && groupsY === 1;

  // Tokenize everything first: the global prefix codes are built from all streams.
  let tree = channelTreeTokens(metaChannels.length + numChannels);
  const ctx = (i: number): number => tree.channelContext[i]!;
  // Property 0 is the channel's index within its stream: after the meta channels in the
  // global stream, from 0 in pass groups.
  // ponytail: group channel c shares meta channel c's context; split on stream id if that matters.
  const imageChannels = (first: number, x0: number, y0: number, w: number, h: number): ChannelRect[] =>
    planes.map((plane, c) => ({ plane, stride: width, x0, y0, w, h, ctx: ctx(first + c) }));
  // Meta channels are always in the global image; image channels only when the frame is one group.
  const globalChannels: ChannelRect[] = metaChannels.map((plane, i) => ({
    plane,
    stride: plane.length,
    x0: 0,
    y0: 0,
    w: plane.length,
    h: 1,
    ctx: ctx(i),
  }));
  if (singleGroup) globalChannels.push(...imageChannels(metaChannels.length, 0, 0, width, height));
  let globalStream = tokenize(globalChannels);
  let groupStreams: TokenStream[] = [];
  const groupChannels: ChannelRect[][] = [];
  if (!singleGroup) {
    for (let gy = 0; gy < groupsY; gy++) {
      for (let gx = 0; gx < groupsX; gx++) {
        const x0 = gx * groupDim;
        const y0 = gy * groupDim;
        const channels = imageChannels(0, x0, y0, Math.min(groupDim, width - x0), Math.min(groupDim, height - y0));
        groupChannels.push(channels);
        groupStreams.push(tokenize(channels));
      }
    }
  }
  let dataCode = JxlEncEntropyCode.buildModular(tree.numLeaves, [globalStream, ...groupStreams]);
  const originalStreams = [globalStream, ...groupStreams];
  const weightedStreams = [
    tokenize(globalChannels, true),
    ...groupChannels.map((channels) => tokenize(channels, true)),
  ];
  const gradientCosts = estimateContextBits(originalStreams, tree.numLeaves);
  const weightedCosts = estimateContextBits(weightedStreams, tree.numLeaves);
  const predictors = Array.from({ length: tree.numLeaves }, (_, ctx) =>
    weightedCosts[ctx]! < gradientCosts[ctx]! ? 6 : PREDICTOR_GRADIENT,
  );
  if (predictors.includes(6)) {
    const mixedStreams = originalStreams.map((stream, j) => ({
      contexts: stream.contexts,
      values: Float64Array.from(stream.values, (value, i) =>
        predictors[stream.contexts[i]!] === 6 ? weightedStreams[j]!.values[i]! : value,
      ),
    }));
    const mixedTree = channelTreeTokens(metaChannels.length + numChannels, predictors);
    const mixedCode = JxlEncEntropyCode.buildModular(tree.numLeaves, mixedStreams);
    const size = (code: JxlEncEntropyCode, streams: TokenStream[], treeStream: TokenStream): number => {
      const w = new JxlBitWriter();
      const treeCode = JxlEncEntropyCode.build(6, [treeStream]);
      treeCode.writeHeader(w);
      treeCode.writeStream(w, treeStream);
      code.writeHeader(w);
      for (const stream of streams) code.writeStream(w, stream);
      return w.bitPosition;
    };
    if (size(mixedCode, mixedStreams, mixedTree.stream) < size(dataCode, originalStreams, tree.stream)) {
      tree = mixedTree;
      dataCode = mixedCode;
      globalStream = mixedStreams[0]!;
      groupStreams = mixedStreams.slice(1);
    }
  }
  const treeCode = JxlEncEntropyCode.build(6, [tree.stream]);

  // LfGlobal: dequant defaults, global MA tree + codes, global modular image.
  const lfGlobal = new JxlBitWriter();
  lfGlobal.writeBool(true); // LfChannelDequantization.all_default
  lfGlobal.writeBool(true); // use_global_tree
  treeCode.writeHeader(lfGlobal);
  treeCode.writeStream(lfGlobal, tree.stream);
  dataCode.writeHeader(lfGlobal);
  writeModularHeader(lfGlobal, transforms);
  dataCode.writeStream(lfGlobal, globalStream);

  const sections = [lfGlobal.finish()];
  if (!singleGroup) {
    const lfGroupDim = groupDim * 8;
    const numLfGroups = Math.ceil(width / lfGroupDim) * Math.ceil(height / lfGroupDim);
    const empty = new Uint8Array(0);
    for (let i = 0; i < numLfGroups; i++) sections.push(empty); // no LF-resolution channels
    sections.push(empty); // HfGlobal is empty for Modular
    for (const stream of groupStreams) {
      const pass = new JxlBitWriter();
      writeModularHeader(pass, []);
      dataCode.writeStream(pass, stream);
      sections.push(pass.finish());
    }
  }

  const w = new JxlBitWriter();
  w.writeBits(8, 0xff);
  w.writeBits(8, 0x0a);
  writeSizeHeader(w, width, height);
  writeImageMetadata(w, bitDepth, hasAlpha, image.linearColorSpace);
  writeFrameHeader(w, hasAlpha, groupSizeShift);
  writeToc(
    w,
    sections.map((s) => s.length),
  );
  for (const s of sections) w.writeBytes(s);
  const codestream = w.finish();
  return options.container ? wrapJxlContainer(codestream) : codestream;
}

type Transform = { type: 'rct' } | { type: 'palette'; beginC: number; numColours: number };

/** Modular stream header: global tree, default weighted-predictor params, transforms. */
function writeModularHeader(w: JxlBitWriter, transforms: Transform[]): void {
  w.writeBool(true); // use_global_tree
  w.writeBool(true); // wp_header.all_default
  w.writeU32(transforms.length, 0, 1, { bits: 4, offset: 2 }, { bits: 8, offset: 18 }); // nb_transforms
  const beginC = (c: number): void =>
    w.writeU32(c, { bits: 3, offset: 0 }, { bits: 6, offset: 8 }, { bits: 10, offset: 72 }, { bits: 13, offset: 1096 });
  for (const t of transforms) {
    if (t.type === 'rct') {
      w.writeBits(2, 0); // TransformId = kRCT
      beginC(0);
      w.writeU32(6, 6, { bits: 2, offset: 0 }, { bits: 4, offset: 2 }, { bits: 6, offset: 10 }); // rct_type = YCoCg
    } else {
      w.writeBits(2, 1); // TransformId = kPalette
      beginC(t.beginC);
      w.writeU32(1, 1, 3, 4, { bits: 13, offset: 1 }); // num_c
      w.writeU32(
        t.numColours,
        { bits: 8, offset: 0 },
        { bits: 10, offset: 256 },
        { bits: 12, offset: 1280 },
        { bits: 16, offset: 5376 },
      );
      w.writeU32(0, 0, { bits: 8, offset: 1 }, { bits: 10, offset: 257 }, { bits: 16, offset: 1281 }); // nb_deltas
      w.writeBits(4, 0); // d_pred (unused without deltas)
    }
  }
}

interface TransformPlan {
  planes: Int32Array[];
  metaChannels: Int32Array[];
  transforms: Transform[];
  estimatedBits: number;
}

/** Apply (optionally) RCT, then a channel palette to each channel it compacts. */
function transformPlan(source: Int32Array[], width: number, height: number, rct: boolean): TransformPlan {
  const planes = source.map((p) => p.slice());
  const transforms: Transform[] = [];
  if (rct) {
    forwardYCoCg(planes);
    transforms.push({ type: 'rct' });
  }
  // Each palette inserts its meta channel (the sorted values, nb_colours x 1) at index 0.
  const metaChannels: Int32Array[] = [];
  for (let c = 0; c < planes.length; c++) {
    const palette = channelPalette(planes[c]!);
    if (!palette) continue;
    applyPalette(planes[c]!, palette);
    transforms.push({ type: 'palette', beginC: c + metaChannels.length, numColours: palette.length });
    metaChannels.unshift(palette);
  }
  // Estimate as one group with a context per channel, as encoded below.
  const channels: ChannelRect[] = [
    ...metaChannels.map((plane, i) => ({ plane, stride: plane.length, x0: 0, y0: 0, w: plane.length, h: 1, ctx: i })),
    ...planes.map((plane, c) => ({
      plane,
      stride: width,
      x0: 0,
      y0: 0,
      w: width,
      h: height,
      ctx: metaChannels.length + c,
    })),
  ];
  const estimatedBits = estimateStreamBits(tokenize(channels), channels.length);
  return { planes, metaChannels, transforms, estimatedBits };
}

/** Largest nb_colours the Palette transform can code. */
const MAX_PALETTE_COLOURS = 5376 + 0xffff;

/**
 * Sorted distinct values of `plane` when a channel palette compacts it (fewer than a
 * quarter of the values in its range are used), else undefined.
 */
function channelPalette(plane: Int32Array): Int32Array | undefined {
  const seen = new Set<number>();
  let min = plane[0]!;
  let max = min;
  for (const v of plane) {
    if (seen.has(v)) continue;
    if (seen.size === MAX_PALETTE_COLOURS) return undefined;
    seen.add(v);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // ponytail: fixed density threshold; libjxl estimates the cost of each option instead.
  if (seen.size * 4 > max - min + 1) return undefined;
  return Int32Array.from(seen).toSorted();
}

/** Replace samples by their index in the sorted `palette`. */
function applyPalette(plane: Int32Array, palette: Int32Array): void {
  const index = new Map<number, number>();
  for (let i = 0; i < palette.length; i++) index.set(palette[i]!, i);
  for (let i = 0; i < plane.length; i++) plane[i] = index.get(plane[i]!)!;
}

/** Interleaved RGBA floats → one Int32Array plane per channel of Modular sample values. */
function toPlanes(
  data: Float32Array,
  numPixels: number,
  numChannels: number,
  format: NonNullable<WriteJxlOptions['bitDepth']>,
): Int32Array[] {
  const planes = Array.from({ length: numChannels }, () => new Int32Array(numPixels));
  if (format === 'float32') {
    // libjxl float_to_int: 32-bit float samples are the raw IEEE bit patterns.
    const bits = new Int32Array(data.buffer, data.byteOffset, data.length);
    for (let c = 0; c < numChannels; c++) {
      const p = planes[c]!;
      for (let i = 0; i < numPixels; i++) p[i] = bits[i * 4 + c]!;
    }
    return planes;
  }
  const max = format === 'uint16' ? 65535 : 255;
  for (let c = 0; c < numChannels; c++) {
    const p = planes[c]!;
    for (let i = 0; i < numPixels; i++) {
      const v = data[i * 4 + c]!;
      // Half samples are the binary16 bit pattern (sign in bit 15), as libjxl float_to_int.
      p[i] = format === 'float16' ? encodeFloat16(v) : v > 0 ? (v < 1 ? Math.round(v * max) : max) : 0;
    }
  }
  return planes;
}

/**
 * Forward of RCT type 6 (YCoCg-R) on channels 0..2, inverse of the spec's rct_type 6.
 * Every step wraps to int32, so it inverts exactly under the decoder's 32-bit arithmetic
 * even for float32 bit patterns.
 */
function forwardYCoCg(planes: Int32Array[]): void {
  const r = planes[0]!;
  const g = planes[1]!;
  const b = planes[2]!;
  for (let i = 0; i < r.length; i++) {
    const co = (r[i]! - b[i]!) | 0;
    const tmp = (b[i]! + (co >> 1)) | 0;
    const cg = (g[i]! - tmp) | 0;
    r[i] = tmp + (cg >> 1); // Y
    g[i] = co;
    b[i] = cg;
  }
}

type TreeNode = { channel: number } | { splitAbove: number; left: TreeNode; right: TreeNode };

/** Balanced tree over channels [lo, hi] splitting on property 0 (channel index). */
function channelTree(lo: number, hi: number): TreeNode {
  if (lo === hi) return { channel: lo };
  const mid = (lo + hi) >> 1;
  return { splitAbove: mid, left: channelTree(mid + 1, hi), right: channelTree(lo, mid) };
}

/**
 * MA tree tokens (tree contexts 0..5 as in the spec) for a per-channel tree whose
 * leaves choose gradient or weighted prediction. Nodes are written breadth-first, left
 * (property > value) child first; leaf contexts are numbered in that order.
 */
function channelTreeTokens(
  numChannels: number,
  predictors?: number[],
): {
  stream: TokenStream;
  channelContext: number[];
  numLeaves: number;
} {
  const contexts: number[] = [];
  const values: number[] = [];
  const push = (ctx: number, v: number): void => {
    contexts.push(ctx);
    values.push(v);
  };
  const channelContext: number[] = [];
  let numLeaves = 0;
  const queue = [channelTree(0, numChannels - 1)];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]!;
    if ('channel' in node) {
      const context = numLeaves++;
      channelContext[node.channel] = context;
      push(1, 0); // leaf
      push(2, predictors?.[context] ?? PREDICTOR_GRADIENT);
      push(3, packSigned(0)); // offset
      push(4, 0); // multiplier log
      push(5, 0); // multiplier bits
    } else {
      push(1, 0 + 1); // property 0 (channel), +1
      push(0, packSigned(node.splitAbove));
      queue.push(node.left, node.right);
    }
  }
  return { stream: { contexts, values }, channelContext, numLeaves };
}

/** A channel's rectangle to code, with its MA-tree context. */
interface ChannelRect {
  plane: Int32Array;
  stride: number;
  x0: number;
  y0: number;
  w: number;
  h: number;
  ctx: number;
}

/** Predict channels in order, returning (context, packed residual) per sample. */
function tokenize(channels: ChannelRect[], weighted = false): TokenStream {
  let total = 0;
  for (const ch of channels) total += ch.w * ch.h;
  const contexts = new Uint8Array(total);
  const values = new Float64Array(total);
  let k = 0;
  for (const { plane: p, stride, x0, y0, w, h, ctx } of channels) {
    contexts.fill(ctx, k, k + w * h);
    const wp = weighted ? new WpState(defaultWpHeader(), w) : undefined;
    for (let y = 0; y < h; y++) {
      const row = (y0 + y) * stride + x0;
      const up = row - stride;
      for (let x = 0; x < w; x++) {
        // Edge rules: W falls back to N then 0; N to W; NW to W.
        const west = x > 0 ? p[row + x - 1]! : y > 0 ? p[up + x]! : 0;
        const north = y > 0 ? p[up + x]! : west;
        const northWest = x > 0 && y > 0 ? p[up + x - 1]! : west;
        const grad = west + north - northWest;
        const lo = Math.min(west, north);
        const hi = Math.max(west, north);
        const northEast = x + 1 < w && y > 0 ? p[up + x + 1]! : north;
        const northNorth = y > 1 ? p[row - stride * 2 + x]! : north;
        const pred = wp
          ? wp.predict(x, y, north, west, northEast, northWest, northNorth)
          : grad < lo
            ? lo
            : grad > hi
              ? hi
              : grad;
        // Residuals wrap to int32 like the decoder's 32-bit sample arithmetic.
        values[k++] = packSigned((p[row + x]! - pred) | 0);
        wp?.update(p[row + x]!, x, y);
      }
    }
  }
  return { contexts, values };
}
