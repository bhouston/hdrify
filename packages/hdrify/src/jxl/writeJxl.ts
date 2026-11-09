import { readIccProfile } from 'hdrify-icc';
import { encodeFloat16 } from '../exr/halfFloat.js';
import { ensureNonNegativeFinite, type HdrifyImage } from '../hdrifyImage.js';
import { factorMaResiduals, learnMaTree, learnedLeaf, type JxlLearnedModel, type JxlMaSample } from './jxlEncMaTree.js';
import { defaultWpHeader, predictOne, WpState } from './jxlPredictors.js';
import { writeVardctJxl } from './writeJxlVardct.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import {
  estimateContextBits,
  estimateStreamBits,
  JxlEncEntropyCode,
  packSigned,
  type TokenStream,
} from './jxlEncEntropy.js';
import type { JxlExtraChannel } from './readJxl.js';
import {
  jxlIntensityTarget,
  type JxlEncBitDepth,
  type JxlEncLayout,
  writeFrameHeader,
  writeImageMetadata,
  writeSizeHeader,
  writeToc,
  wrapJxlContainer,
} from './jxlEncHeaders.js';

export interface WriteJxlOptions {
  /** Lossless compression search: 'standard' (default) uses prefix codes;
   * 'high' also tries ANS and learned MA trees, retaining the smaller complete model.
   * High is available only for lossless output and can take several times longer.
   * Tree training uses at most 65,536 deterministic samples, depth 6, and 255 leaf contexts.
   */
  effort?: 'standard' | 'high';
  /** Encode lossy XYB VarDCT instead of lossless Modular (default false). */
  lossy?: boolean;
  /** Quantization distance for lossy output, > 0 and <= 25 (default 1). Smaller values retain more detail.
   * This initial fixed-DCT encoder does not match libjxl's perceptual distance calibration.
   */
  distance?: number;
  /**
   * Source sample format. 'float16' (default) rounds to half floats like EXR HALF;
   * 'float32' keeps source precision; 'uint16'/'uint8' clamp to [0, 1] and quantize.
   * Lossless RGB and alpha preserve these samples exactly. Lossy RGB is additionally
   * quantized according to distance; alpha still preserves the selected sample format.
   */
  bitDepth?: 'float16' | 'float32' | 'uint16' | 'uint8';
  /** Write an alpha channel. Default: only when some alpha value is not 1. */
  alpha?: boolean;
  /** Wrap the codestream in the ISOBMFF container (default false: bare codestream). */
  container?: boolean;
  /** Replace negative and non-finite values with 0 in place first, like writeExr (default true). */
  sanitize?: boolean;
  /** Lossless Modular group size: 128 << groupSizeShift pixels (0..3, default 1 → 256).
   * Lossy VarDCT supports only the default 256-pixel groups. */
  groupSizeShift?: number;
  /**
   * Extra channels written after alpha as lossless channels in the selected sample format,
   * in both lossless and lossy output. Each must be full resolution (`width` x `height`,
   * in stored orientation) and `spotColor` channels need a `spotColor`. Entries of type
   * 'alpha' are skipped (alpha comes from `image.data`). Default: `image.metadata.extraChannels`
   * (as returned by {@link readJxl}), skipping entries whose size no longer matches the image.
   */
  extraChannels?: readonly JxlExtraChannel[];
  /** Mark alpha as associated: `image.data` colour is already premultiplied, as read with
   * `keepPremultipliedAlpha`. Ignored without alpha. Default: `image.metadata.alphaPremultiplied`. */
  alphaPremultiplied?: boolean;
  /**
   * Write a grey image (colour_space kGrey, one colour channel) from the R samples; G and B are ignored.
   * 'auto' (default) does this only when every pixel has R == G == B. Ignored by {@link writeJxlEncoded}.
   */
  grayscale?: boolean | 'auto';
  /** EXIF orientation 1..8 to store; pixels are written as given, in stored orientation, as read with
   * `applyOrientation: false`. Default 1: `metadata.orientation` is not reused because {@link readJxl}
   * applies it to the pixels by default. */
  orientation?: number;
}

const BIT_DEPTHS: Record<NonNullable<WriteJxlOptions['bitDepth']>, JxlEncBitDepth> = {
  float16: { float: true, bitsPerSample: 16, expBits: 5 },
  float32: { float: true, bitsPerSample: 32, expBits: 8 },
  uint16: { float: false, bitsPerSample: 16, expBits: 0 },
  uint8: { float: false, bitsPerSample: 8, expBits: 0 },
};

const PREDICTOR_GRADIENT = 5;

/**
 * Encode an image as lossless Modular or lossy VarDCT JPEG XL.
 * Lossless encoding uses Gradient/Weighted prediction, prefix/LZ77 codes and estimated-cost transforms; high effort also tries ANS.
 * Lossy encoding uses XYB, fixed DCT8 blocks and distance-controlled uniform quantization;
 * alpha remains lossless in the selected source sample format.
 * The lossy encoder uses default JPEG XL quantization tables and has no adaptive
 * quantization, larger transforms, or restoration filters. Distance controls
 * quantization strength and is not calibrated to libjxl's perceptual distance.
 * Reproduce corpus size/error measurements with `node scripts/benchmark-jxl-lossy.mjs` after building.
 *
 * Input pixels are linear light; native JPEG XL color fields describe their primaries.
 * `metadata.linearReferenceWhiteNits` (set by {@link readJxl}) is written as the intensity target,
 * the luminance in nits of linear 1.0, so HDR brightness survives a round trip; without it, 255 nits.
 * `metadata.iccProfile` is never attached automatically. For samples already encoded
 * in an ICC profile's space, use {@link writeJxlEncoded}.
 *
 * @param image - Linear floating-point RGBA image.
 * @param options - Compression, sample precision, alpha, and container options.
 * @returns JPEG XL codestream or container bytes.
 */
export function writeJxl(image: HdrifyImage, options: WriteJxlOptions = {}): Uint8Array {
  return writeJxlImage(image, options);
}

/** Caller-supplied ICC-encoded RGB samples, stored in RGBA order. No color conversion is performed. */
export interface JxlEncodedImage {
  width: number;
  height: number;
  data: Float32Array;
  /** Raw complete ICC profile, including arbitrary/unknown tag payloads. Must describe RGB samples. */
  iccProfile: Uint8Array;
}

/**
 * Write ICC-encoded RGB samples as lossless Modular JPEG XL.
 * The caller supplies RGBA samples in the profile's encoded space. This function
 * performs no color conversion or ICC curve/LUT evaluation. It validates the profile
 * structure and RGB channel declaration, then retains the complete profile bytes,
 * including unknown tags and RGB LUT profiles.
 *
 * Gray/CMYK layouts and lossy XYB encoding throw. Storing a profile does not add
 * support for interpreting it on read; see {@link readJxl} for color-management support.
 * Float32 preserves signed finite values; float16 rounds to half precision.
 * Integer formats clamp to [0, 1]. Alpha follows the selected sample format.
 * `sanitize` defaults to false, leaving input pixels unchanged; explicitly enabling
 * it replaces negative and non-finite values in place.
 *
 * @param image - Caller-encoded RGBA samples and a matching raw RGB ICC profile.
 * @param options - Lossless encoding options, with sanitization disabled by default.
 * @returns JPEG XL codestream or container bytes retaining the supplied profile.
 * @example
 * ```ts
 * const bytes = writeJxlEncoded(
 *   { width, height, data: encodedRgbaFloat32, iccProfile: rawIccBytes },
 *   { bitDepth: 'float32', container: true },
 * );
 * ```
 */
export function writeJxlEncoded(image: JxlEncodedImage, options: WriteJxlOptions = {}): Uint8Array {
  if (options.lossy) throw new Error('writeJxlEncoded: only lossless Modular output is supported');
  if (image.iccProfile.length > 1 << 26) throw new Error('writeJxlEncoded: ICC profile exceeds 64 MiB');
  const profile = readIccProfile(image.iccProfile);
  if (String.fromCharCode(...profile.header.subarray(16, 20)) !== 'RGB ')
    throw new Error('writeJxlEncoded: ICC profile must describe RGB samples; gray/CMYK layouts are unsupported');
  if (
    new DataView(image.iccProfile.buffer, image.iccProfile.byteOffset, image.iccProfile.byteLength).getUint32(0) !==
    image.iccProfile.length
  )
    throw new Error('writeJxlEncoded: ICC profile has trailing bytes');
  return writeJxlImage(
    { ...image, linearColorSpace: 'linear-rec709' },
    { ...options, sanitize: options.sanitize ?? false },
    image.iccProfile,
  );
}

function writeJxlImage(image: HdrifyImage, options: WriteJxlOptions, iccProfile?: Uint8Array): Uint8Array {
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
  if (options.effort !== undefined && options.effort !== 'standard' && options.effort !== 'high') {
    throw new Error('writeJxl: effort must be standard or high');
  }
  if (options.lossy) {
    if (options.effort === 'high') throw new Error('writeJxl: high effort is only supported for lossless output');
    const distance = options.distance ?? 1;
    if (!Number.isFinite(distance) || distance <= 0 || distance > 25) {
      throw new Error('writeJxl: distance must be > 0 and <= 25');
    }
    if (groupSizeShift !== 1) throw new Error('writeJxl: lossy output requires groupSizeShift 1 (256 pixels)');
  }
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

  const orientation = options.orientation ?? 1;
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8)
    throw new Error(`writeJxl: orientation must be 1..8, got ${orientation}`);
  const metadata = image.metadata as { extraChannels?: JxlExtraChannel[]; alphaPremultiplied?: boolean } | undefined;
  const extras = (
    options.extraChannels ??
    metadata?.extraChannels?.filter((ec) => ec.width === width && ec.height === height) ??
    []
  ).filter((ec) => ec.type !== 'alpha');
  for (const ec of extras) {
    if (ec.width !== width || ec.height !== height || ec.data.length !== width * height)
      throw new Error(`writeJxl: extra channel ${ec.name} must be ${width}x${height}`);
    if (ec.type === 'spotColor' && ec.spotColor?.length !== 4)
      throw new Error(`writeJxl: spot colour channel ${ec.name} needs spotColor`);
  }
  const grayscale = options.grayscale ?? 'auto';
  let grey = !iccProfile && !!grayscale;
  if (grey && grayscale === 'auto') {
    for (let i = 0; i < data.length && grey; i += 4) grey = data[i] === data[i + 1] && data[i] === data[i + 2];
  }
  const layout: JxlEncLayout = {
    grey,
    orientation,
    extraChannels: [
      ...(hasAlpha
        ? [{ type: 'alpha' as const, alphaAssociated: !!(options.alphaPremultiplied ?? metadata?.alphaPremultiplied) }]
        : []),
      ...extras,
    ],
  };
  const numPixels = width * height;
  const ecPlanes = [
    ...(hasAlpha ? [toPlane(data, 4, 3, numPixels, format)] : []),
    ...extras.map((ec) => toPlane(ec.data, 1, 0, numPixels, format)),
  ];

  if (options.lossy) return writeVardctJxl(image, options, bitDepth, layout, ecPlanes);
  let planes = [...(grey ? [0] : [0, 1, 2]).map((c) => toPlane(data, 4, c, numPixels, format)), ...ecPlanes];
  const numChannels = planes.length;

  // Pick the cheaper of: channel palettes on the raw channels, or YCoCg RCT followed by
  // channel palettes (a cheap stand-in for libjxl's transform search).
  let plan = transformPlan(planes, width, height, false);
  if (!grey) {
    const withRct = transformPlan(planes, width, height, true);
    if (withRct.estimatedBits < plan.estimatedBits) plan = withRct;
  }
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
  let dataCode = JxlEncEntropyCode.buildModular(
    tree.numLeaves,
    [globalStream, ...groupStreams],
    options.effort === 'high',
  );
  const originalStreams = [globalStream, ...groupStreams];
  const samples: JxlMaSample[] = [];
  const stride = Math.max(1, Math.ceil(originalStreams.reduce((sum, stream) => sum + stream.values.length, 0) / 65536));
  const allChannels = [globalChannels, ...groupChannels];
  const weightedStreams = allChannels.map((channels, i) =>
    tokenize(
      channels,
      true,
      undefined,
      options.effort === 'high' ? { stride, samples, gradient: originalStreams[i]! } : undefined,
    ),
  );
  const gradientCosts = estimateContextBits(originalStreams, tree.numLeaves);
  const weightedCosts = estimateContextBits(weightedStreams, tree.numLeaves);
  const predictors = Array.from({ length: tree.numLeaves }, (_, ctx) =>
    weightedCosts[ctx]! < gradientCosts[ctx]! ? 6 : PREDICTOR_GRADIENT,
  );
  if (predictors.includes(6)) {
    const mixedStreams = originalStreams.map((stream, j) => {
      const values = new Uint32Array(stream.values.length);
      const weighted = weightedStreams[j]!.values;
      for (let i = 0; i < values.length; i++)
        values[i] = predictors[stream.contexts[i]!] === 6 ? weighted[i]! : stream.values[i]!;
      return { contexts: stream.contexts, values };
    });
    const mixedTree = channelTreeTokens(metaChannels.length + numChannels, predictors);
    const mixedCode = JxlEncEntropyCode.buildModular(tree.numLeaves, mixedStreams, options.effort === 'high');
    if (modelSize(mixedCode, mixedTree.stream) < modelSize(dataCode, tree.stream)) {
      tree = mixedTree;
      dataCode = mixedCode;
      globalStream = mixedStreams[0]!;
      groupStreams = mixedStreams.slice(1);
    }
  }
  if (options.effort === 'high') {
    const learned = learnMaTree(samples, tree.channelContext);
    if (learned) {
      const streams = factorMaResiduals(
        learned,
        allChannels.map((channels) => tokenize(channels, false, learned)),
      );
      const code = JxlEncEntropyCode.buildModular(learned.numLeaves, streams, true);
      if (modelSize(code, learned.stream) < modelSize(dataCode, tree.stream)) {
        tree = { ...tree, numLeaves: learned.numLeaves, stream: learned.stream };
        dataCode = code;
        globalStream = streams[0]!;
        groupStreams = streams.slice(1);
      }
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
  writeImageMetadata(w, bitDepth, layout, image.linearColorSpace, false, iccProfile, jxlIntensityTarget(image));
  writeFrameHeader(w, layout.extraChannels.length, groupSizeShift);
  writeToc(
    w,
    sections.map((s) => s.length),
  );
  for (const s of sections) w.writeBytes(s);
  const codestream = w.finish();
  return options.container ? wrapJxlContainer(codestream) : codestream;
}

function modelSize(code: JxlEncEntropyCode, treeStream: TokenStream): number {
  const w = new JxlBitWriter();
  const treeCode = JxlEncEntropyCode.build(6, [treeStream]);
  treeCode.writeHeader(w);
  treeCode.writeStream(w, treeStream);
  return w.bitPosition + code.encodedSizeBits;
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
    const indexed = planes[c]!.slice();
    applyPalette(indexed, palette);
    const channel = (plane: Int32Array, w: number, h: number, ctx: number): ChannelRect => ({
      plane,
      stride: w,
      x0: 0,
      y0: 0,
      w,
      h,
      ctx,
    });
    const originalBits = estimateStreamBits(tokenize([channel(planes[c]!, width, height, 0)]), 1);
    const paletteBits =
      estimateStreamBits(tokenize([channel(palette, palette.length, 1, 0), channel(indexed, width, height, 1)]), 2) +
      48; // transform fields and an additional entropy context
    if (paletteBits >= originalBits) continue;
    planes[c] = indexed;
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

/** Sorted distinct values, bounded by the format's palette-size limit.
 * The caller compares residual cost, palette payload and transform overhead.
 */
function channelPalette(plane: Int32Array): Int32Array | undefined {
  const seen = new Set<number>();
  for (const v of plane) {
    if (seen.has(v)) continue;
    if (seen.size === MAX_PALETTE_COLOURS) return undefined;
    seen.add(v);
  }
  return Int32Array.from(seen).toSorted();
}

/** Replace samples by their index in the sorted `palette`. */
function applyPalette(plane: Int32Array, palette: Int32Array): void {
  const index = new Map<number, number>();
  for (let i = 0; i < palette.length; i++) index.set(palette[i]!, i);
  for (let i = 0; i < plane.length; i++) plane[i] = index.get(plane[i]!)!;
}

/** Channel `offset` of interleaved floats with `stride` samples per pixel → Modular sample values. */
export function toPlane(
  data: Float32Array,
  stride: number,
  offset: number,
  numPixels: number,
  format: NonNullable<WriteJxlOptions['bitDepth']>,
): Int32Array {
  const p = new Int32Array(numPixels);
  if (format === 'float32') {
    // libjxl float_to_int: 32-bit float samples are the raw IEEE bit patterns.
    const bits = new Int32Array(data.buffer, data.byteOffset, data.length);
    for (let i = 0; i < numPixels; i++) p[i] = bits[i * stride + offset]!;
    return p;
  }
  const max = format === 'uint16' ? 65535 : 255;
  for (let i = 0; i < numPixels; i++) {
    const v = data[i * stride + offset]!;
    // Half samples are the binary16 bit pattern (sign in bit 15), as libjxl float_to_int.
    p[i] = format === 'float16' ? encodeFloat16(v) : v > 0 ? (v < 1 ? Math.round(v * max) : max) : 0;
  }
  return p;
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
function tokenize(
  channels: ChannelRect[],
  weighted = false,
  model?: JxlLearnedModel,
  capture?: { stride: number; samples: JxlMaSample[]; gradient: TokenStream },
): TokenStream {
  let total = 0;
  for (const ch of channels) total += ch.w * ch.h;
  const contexts = new Uint8Array(total);
  const values = new Uint32Array(total);
  let k = 0;
  for (const { plane: p, stride, x0, y0, w, h, ctx } of channels) {
    contexts.fill(ctx, k, k + w * h);
    const wp = weighted || model?.usesWp[ctx] ? new WpState(defaultWpHeader(), w) : undefined;
    const properties = new Int32Array(16);
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
        const wpPred = wp?.predict(x, y, north, west, northEast, northWest, northNorth) ?? 0;
        let predictor = weighted ? 6 : 5;
        const sample = capture && capture.samples.length < 65536 && k % capture.stride === 0;
        if (model || sample) {
          properties[4] = Math.abs(north);
          properties[5] = Math.abs(west);
          properties[9] = grad;
          properties[10] = west - northWest;
          properties[11] = northWest - north;
          properties[12] = north - northEast;
          properties[13] = north - northNorth;
          properties[14] = west - (x > 1 ? p[row + x - 2]! : west);
          properties[15] = wp?.maxError ?? 0;
        }
        let offset = 0;
        if (model) {
          const leaf = learnedLeaf(model.roots[ctx]!, properties);
          contexts[k] = leaf.context;
          predictor = leaf.predictor;
          offset = leaf.offset;
        }
        const pred =
          predictor === 6
            ? wpPred
            : predictor === 5
              ? grad < lo
                ? lo
                : grad > hi
                  ? hi
                  : grad
              : predictOne(
                  predictor,
                  west,
                  north,
                  northNorth,
                  northWest,
                  northEast,
                  x > 1 ? p[row + x - 2]! : west,
                  x + 2 < w && y > 0 ? p[up + x + 2]! : northEast,
                  wpPred,
                );
        // Residuals wrap to int32 like the decoder's 32-bit sample arithmetic.
        values[k] = packSigned((p[row + x]! - pred - offset) | 0);
        if (sample && capture)
          capture.samples.push({
            context: ctx,
            properties: properties.slice(),
            gradient: capture.gradient.values[k]!,
            weighted: values[k]!,
            left: packSigned((p[row + x]! - west) | 0),
            top: packSigned((p[row + x]! - north) | 0),
            average: packSigned((p[row + x]! - Math.trunc((west + north) / 2)) | 0),
            select: packSigned(
              (p[row + x]! - (Math.abs(north - northWest) < Math.abs(west - northWest) ? west : north)) | 0,
            ),
          });
        k++;
        wp?.update(p[row + x]!, x, y);
      }
    }
  }
  return { contexts, values };
}
