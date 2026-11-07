/**
 * Modular sub-bitstream decoder (ISO/IEC 18181-1 Annex H). Port of libjxl
 * lib/jxl/modular/encoding/encoding.cc (ModularDecode, DecodeModularChannelMAANS) and the group
 * splitting of lib/jxl/dec_modular.cc (ModularFrameDecoder::DecodeGroup).
 *
 * Samples are int32 (`Int32Array`), like libjxl `pixel_type`: all sample arithmetic wraps modulo
 * 2^32 (typed-array stores / `|0`), while predictions use exact JS-number arithmetic standing in for
 * libjxl's int64 `pixel_type_w`. Lossless float32 is stored as raw IEEE bit patterns reinterpreted
 * as int32 (libjxl dec_modular.cc / jxl-oxide), so Int32Array is the exact representation.
 */
import { type JxlBitReader, unpackSigned } from './jxlBitReader.js';
import type { JxlEntropyDecoder } from './jxlEntropy.js';
import { filterTree, type MaTree, NUM_NONREF_PROPERTIES, readMaTree } from './jxlMaTree.js';
import {
  applyInverseTransforms,
  metaApplyTransform,
  readTransform,
  type TransformInfo,
} from './jxlModularTransforms.js';
import { clampedGradient, predictOne, readWpHeader, type WpHeader, WpState } from './jxlPredictors.js';

export { applyInverseTransforms } from './jxlModularTransforms.js';
export type { TransformInfo } from './jxlModularTransforms.js';

export interface ModularChannelInfo {
  width: number;
  height: number;
  hshift: number;
  vshift: number;
}

export interface ModularChannel extends ModularChannelInfo {
  /** Row-major samples, `width * height`. */
  data: Int32Array;
}

export interface ModularImage {
  /** Channel list after the header's transforms were applied (meta channels first). */
  channels: ModularChannel[];
  nbMetaChannels: number;
  /** Transforms still to undo (in bitstream order; undone in reverse). */
  transforms: TransformInfo[];
  wpHeader: WpHeader;
  /** Image bit depth, used by the palette's implicit colours. */
  bitDepth: number;
}

export interface ModularDecodeOptions {
  globalTree?: MaTree;
  globalDecoder?: JxlEntropyDecoder;
  /** Modular stream id (property 1); see `modularStreamId`. */
  streamId: number;
  /** Non-meta channels beyond the first one larger than this (in either dimension) are not decoded here (GlobalModular: group_dim). */
  maxChanSize?: number;
  /** Sample bit depth (for palette); default 8. */
  bitDepth?: number;
  /** Tolerate a truncated stream: decoding stops at end of data, remaining samples stay 0. */
  allowPartial?: boolean;
}

/**
 * Decode a Modular sub-bitstream (GroupHeader + optional local MA tree + channel data; libjxl
 * ModularDecode). `channels` describes the image before transforms; the header's transforms
 * reshape the channel list before decoding. Returns the image with transforms NOT yet undone
 * (call `applyInverseTransforms`), since GlobalModular channels are completed by later groups.
 */
export function decodeModularStream(
  br: JxlBitReader,
  channels: ModularChannelInfo[],
  opts: ModularDecodeOptions,
): ModularImage {
  const img: ModularImage = {
    channels: channels.map((c) => ({
      width: c.width,
      height: c.height,
      hshift: c.hshift,
      vshift: c.vshift,
      data: new Int32Array(0),
    })),
    nbMetaChannels: 0,
    transforms: [],
    wpHeader: { p1C: 16, p2C: 10, p3Ca: 7, p3Cb: 7, p3Cc: 7, p3Cd: 0, p3Ce: 0, w: [13, 12, 12, 12] },
    bitDepth: opts.bitDepth ?? 8,
  };
  if (channels.length === 0) return img;

  const useGlobalTree = br.readBool();
  img.wpHeader = readWpHeader(br);
  const nbTransforms = br.readU32(0, 1, { bits: 4, offset: 2 }, { bits: 8, offset: 18 });
  for (let i = 0; i < nbTransforms; i++) img.transforms.push(readTransform(br));
  for (const t of img.transforms) metaApplyTransform(img, t);
  for (const c of img.channels) c.data = new Int32Array(c.width * c.height);

  const maxChanSize = opts.maxChanSize ?? Number.POSITIVE_INFINITY;
  const chans = img.channels;
  let end = 0;
  let numChans = 0;
  let distMultiplier = 0;
  let pixels = 0;
  for (; end < chans.length; end++) {
    const c = chans[end]!;
    if (end >= img.nbMetaChannels && (c.width > maxChanSize || c.height > maxChanSize)) break;
    pixels += c.width * c.height;
    if (!c.width || !c.height) continue;
    if (c.width > distMultiplier) distMultiplier = c.width;
    numChans++;
  }
  if (numChans === 0) return img;

  let tree: MaTree;
  let decoder: JxlEntropyDecoder;
  if (!useGlobalTree) {
    ({ tree, decoder } = readMaTree(br, Math.min(1 << 20, 1024 + pixels)));
  } else {
    if (!opts.globalTree || !opts.globalDecoder) throw new Error('JXL: global MA tree requested but not available');
    tree = opts.globalTree;
    decoder = opts.globalDecoder.clone();
  }
  decoder.begin(br);
  try {
    for (let i = 0; i < end; i++) {
      const c = chans[i]!;
      if (!c.width || !c.height) continue;
      decodeChannel(br, decoder, img, i, opts.streamId, tree, distMultiplier);
    }
  } catch (e) {
    if (opts.allowPartial && e instanceof Error && /unexpected end/.test(e.message)) return img;
    throw e;
  }
  decoder.finish();
  return img;
}

/** Decode one channel's samples (libjxl DecodeModularChannelMAANS, generic path). */
function decodeChannel(
  br: JxlBitReader,
  dec: JxlEntropyDecoder,
  img: ModularImage,
  chan: number,
  streamId: number,
  globalTree: MaTree,
  distMul: number,
): void {
  const ch = img.channels[chan]!;
  const w = ch.width;
  const h = ch.height;
  const d = ch.data;
  const t = filterTree(globalTree, chan, streamId);
  const { property, ctx, predictor, offset, multiplier } = t;
  const singleLeaf = property[0]! < 0;
  const wp = t.usesWp ? new WpState(img.wpHeader, w) : null;
  const props = new Int32Array(t.numProps);
  props[0] = chan;
  props[1] = streamId;

  // Reference channels for properties 16+: previous channels of identical geometry (PrecomputeReferences).
  const numRefs = (t.numProps - NUM_NONREF_PROPERTIES) / 4;
  const refs: Int32Array[] = [];
  for (let j = chan - 1; j >= 0 && refs.length < numRefs; j--) {
    const o = img.channels[j]!;
    if (o.width === w && o.height === h && o.hshift === ch.hshift && o.vshift === ch.vshift) refs.push(o.data);
  }

  for (let y = 0, i = 0; y < h; y++) {
    props[2] = y;
    props[9] = 0;
    for (let x = 0; x < w; x++, i++) {
      const left = x > 0 ? d[i - 1]! : y > 0 ? d[i - w]! : 0;
      const top = y > 0 ? d[i - w]! : left;
      const topleft = x > 0 && y > 0 ? d[i - w - 1]! : left;
      const topright = x + 1 < w && y > 0 ? d[i - w + 1]! : top;
      const leftleft = x > 1 ? d[i - 2]! : left;
      const toptop = y > 1 ? d[i - 2 * w]! : top;
      const trr = x + 2 < w && y > 0 ? d[i - w + 2]! : topright;
      const wpPred = wp ? wp.predict(x, y, top, left, topright, topleft, toptop) : 0;
      let leaf = 0;
      if (!singleLeaf) {
        props[3] = x;
        props[4] = Math.abs(top);
        props[5] = Math.abs(left);
        props[6] = top;
        props[7] = left;
        props[8] = left - props[9];
        props[9] = left + top - topleft;
        props[10] = left - topleft;
        props[11] = topleft - top;
        props[12] = top - topright;
        props[13] = top - toptop;
        props[14] = left - leftleft;
        props[15] = wp ? wp.maxError : 0;
        for (let k = 0, o = NUM_NONREF_PROPERTIES; k < refs.length; k++, o += 4) {
          const rd = refs[k]!;
          const v = rd[i]!;
          const vleft = x > 0 ? rd[i - 1]! : 0;
          const vtop = y > 0 ? rd[i - w]! : vleft;
          const vtopleft = x > 0 && y > 0 ? rd[i - w - 1]! : vleft;
          const r = v - clampedGradient(vleft, vtop, vtopleft);
          props[o] = Math.abs(v);
          props[o + 1] = v;
          props[o + 2] = Math.abs(r);
          props[o + 3] = r;
        }
        // Tree walk (properties of absent reference channels stay 0).
        let p = property[0]!;
        while (p >= 0) {
          leaf = props[p]! > t.splitVal[leaf]! ? t.left[leaf]! : t.right[leaf]!;
          p = property[leaf]!;
        }
      }
      const token = dec.readUint(br, ctx[leaf]!, distMul);
      const guess =
        offset[leaf]! + predictOne(predictor[leaf]!, left, top, toptop, topleft, topright, leftleft, trr, wpPred);
      const v = (Math.imul(unpackSigned(token), multiplier[leaf]!) + guess) | 0;
      d[i] = v;
      if (wp) wp.update(v, x, y);
    }
  }
}

/**
 * Modular stream id (libjxl ModularStreamId::ID): 0 = GlobalModular; VarDCT LF = 1 + g;
 * ModularLfGroup = 1 + numLfGroups + g; HF metadata = 1 + 2·numLfGroups + g;
 * quant table i = 1 + 3·numLfGroups + i; ModularGroup(pass p) = 1 + 3·numLfGroups + 17 + numGroups·p + g.
 */
export function modularStreamId(
  kind: 'global' | 'vardctLf' | 'lfGroup' | 'hfMeta' | 'quantTable' | 'group',
  index: number,
  numLfGroups: number,
  numGroups = 0,
  pass = 0,
): number {
  if (kind === 'global') return 0;
  if (kind === 'vardctLf') return 1 + index;
  if (kind === 'lfGroup') return 1 + numLfGroups + index;
  if (kind === 'hfMeta') return 1 + 2 * numLfGroups + index;
  if (kind === 'quantTable') return 1 + 3 * numLfGroups + index;
  return 1 + 3 * numLfGroups + 17 + numGroups * pass + index;
}

/**
 * Decode an LfGroup / PassGroup Modular section into the GlobalModular image (libjxl
 * ModularFrameDecoder::DecodeGroup). `x0, y0, size` is the group rectangle in full-resolution
 * pixels, unclamped (LfGroup: size = 8·group_dim, minShift 3, maxShift 1000; PassGroup: size =
 * group_dim and the pass's downsampling bracket). Channels of `full` with min(hshift, vshift) in
 * [minShift, maxShift] after the first channel too large for GlobalModular are decoded, have
 * the group's own transforms undone, and are copied into `full`.
 */
export function decodeModularGroup(
  br: JxlBitReader,
  full: ModularImage,
  rect: { x0: number; y0: number; size: number },
  groupDim: number,
  minShift: number,
  maxShift: number,
  opts: { streamId: number; globalTree?: MaTree; globalDecoder?: JxlEntropyDecoder },
): void {
  const fc = full.channels;
  let c = full.nbMetaChannels;
  while (c < fc.length && fc[c]!.width <= groupDim && fc[c]!.height <= groupDim) c++;
  const targets: { ch: ModularChannel; x0: number; y0: number }[] = [];
  const infos: ModularChannelInfo[] = [];
  for (; c < fc.length; c++) {
    const ch = fc[c]!;
    const shift = Math.min(ch.hshift, ch.vshift);
    if (shift > maxShift || shift < minShift) continue;
    const x0 = rect.x0 >> ch.hshift;
    const y0 = rect.y0 >> ch.vshift;
    const w = Math.max(0, Math.min(rect.size >> ch.hshift, ch.width - x0));
    const h = Math.max(0, Math.min(rect.size >> ch.vshift, ch.height - y0));
    if (w === 0 || h === 0) continue;
    targets.push({ ch, x0, y0 });
    infos.push({ width: w, height: h, hshift: ch.hshift, vshift: ch.vshift });
  }
  if (infos.length === 0) return;
  const sub = decodeModularStream(br, infos, { ...opts, bitDepth: full.bitDepth });
  applyInverseTransforms(sub);
  for (let k = 0; k < targets.length; k++) {
    const { ch, x0, y0 } = targets[k]!;
    const s = sub.channels[k]!;
    for (let y = 0; y < s.height; y++) {
      ch.data.set(s.data.subarray(y * s.width, (y + 1) * s.width), (y0 + y) * ch.width + x0);
    }
  }
}
