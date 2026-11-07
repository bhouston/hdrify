/**
 * Modular transforms (ISO/IEC 18181-1 H.6): RCT, Palette, Squeeze — header parsing, channel-list
 * bookkeeping (libjxl "MetaApply") and inverse transforms. Port of libjxl
 * lib/jxl/modular/transform/{transform,rct,palette,squeeze}.cc.
 */
import type { JxlBitReader } from './jxlBitReader.js';
import type { ModularChannel, ModularImage } from './jxlModular.js';
import { NUM_PREDICTORS, Predictor, predictNoTree, WpState } from './jxlPredictors.js';

export interface SqueezeParams {
  horizontal: boolean;
  inPlace: boolean;
  beginC: number;
  numC: number;
}

export type TransformInfo =
  | { kind: 'rct'; beginC: number; rctType: number }
  | { kind: 'palette'; beginC: number; numC: number; nbColours: number; nbDeltas: number; dPred: number }
  | { kind: 'squeeze'; params: SqueezeParams[] };

function readBeginC(br: JxlBitReader): number {
  return br.readU32({ bits: 3 }, { bits: 6, offset: 8 }, { bits: 10, offset: 72 }, { bits: 13, offset: 1096 });
}

/** Read one TransformInfo bundle (libjxl Transform::VisitFields). */
export function readTransform(br: JxlBitReader): TransformInfo {
  const id = br.readBits(2);
  if (id === 0) {
    const beginC = readBeginC(br);
    const rctType = br.readU32(6, { bits: 2 }, { bits: 4, offset: 2 }, { bits: 6, offset: 10 });
    if (rctType >= 42) throw new Error('JXL: invalid RCT type');
    return { kind: 'rct', beginC, rctType };
  }
  if (id === 1) {
    const beginC = readBeginC(br);
    const numC = br.readU32(1, 3, 4, { bits: 13, offset: 1 });
    const nbColours = br.readU32(
      { bits: 8 },
      { bits: 10, offset: 256 },
      { bits: 12, offset: 1280 },
      { bits: 16, offset: 5376 },
    );
    const nbDeltas = br.readU32(0, { bits: 8, offset: 1 }, { bits: 10, offset: 257 }, { bits: 16, offset: 1281 });
    const dPred = br.readBits(4);
    if (dPred >= NUM_PREDICTORS) throw new Error('JXL: invalid palette predictor');
    return { kind: 'palette', beginC, numC, nbColours, nbDeltas, dPred };
  }
  if (id === 2) {
    const n = br.readU32(0, { bits: 4, offset: 1 }, { bits: 6, offset: 9 }, { bits: 8, offset: 41 });
    const params: SqueezeParams[] = [];
    for (let i = 0; i < n; i++) {
      const horizontal = br.readBool();
      const inPlace = br.readBool();
      const beginC = readBeginC(br);
      const numC = br.readU32(1, 2, 3, { bits: 4, offset: 4 });
      params.push({ horizontal, inPlace, beginC, numC });
    }
    return { kind: 'squeeze', params };
  }
  throw new Error('JXL: invalid transform id');
}

function emptyChannel(width: number, height: number, hshift: number, vshift: number): ModularChannel {
  return { width, height, hshift, vshift, data: new Int32Array(0) };
}

/** libjxl CheckEqualChannels; `nbMeta` (when given) rejects ranges mixing meta and non-meta channels. */
function checkEqualChannels(ch: ModularChannel[], c1: number, c2: number, nbMeta = 0): void {
  if (c1 >= ch.length || c2 >= ch.length || c2 < c1) throw new Error('JXL: invalid transform channel range');
  if (c1 < nbMeta && c2 >= nbMeta) throw new Error('JXL: transform mixes meta and non-meta channels');
  const a = ch[c1]!;
  for (let c = c1 + 1; c <= c2; c++) {
    const b = ch[c]!;
    if (a.width !== b.width || a.height !== b.height || a.hshift !== b.hshift || a.vshift !== b.vshift) {
      throw new Error('JXL: transform channels differ in size');
    }
  }
}

/** Default squeeze parameters (libjxl DefaultSqueezeParameters, kMaxFirstPreviewSize = 8). */
export function defaultSqueezeParams(channels: ModularChannel[], nbMeta: number): SqueezeParams[] {
  const params: SqueezeParams[] = [];
  const nbChannels = channels.length - nbMeta;
  const first = channels[nbMeta];
  if (!first) throw new Error('JXL: squeeze without channels');
  let w = first.width;
  let h = first.height;
  const second = channels[nbMeta + 1];
  if (nbChannels > 2 && second && second.width === w && second.height === h) {
    params.push({ horizontal: true, inPlace: false, beginC: nbMeta + 1, numC: 2 });
    params.push({ horizontal: false, inPlace: false, beginC: nbMeta + 1, numC: 2 });
  }
  const base = { inPlace: true, beginC: nbMeta, numC: nbChannels };
  if (w <= h && h > 8) {
    params.push({ ...base, horizontal: false });
    h = (h + 1) >> 1;
  }
  while (w > 8 || h > 8) {
    if (w > 8) {
      params.push({ ...base, horizontal: true });
      w = (w + 1) >> 1;
    }
    if (h > 8) {
      params.push({ ...base, horizontal: false });
      h = (h + 1) >> 1;
    }
  }
  return params;
}

/**
 * Apply a transform to the channel list description (sizes only; libjxl Transform::MetaApply).
 * Mutates `img.channels` / `img.nbMetaChannels`; fills in default squeeze params.
 */
export function metaApplyTransform(img: ModularImage, t: TransformInfo): void {
  const ch = img.channels;
  if (t.kind === 'rct') {
    checkEqualChannels(ch, t.beginC, t.beginC + 2, img.nbMetaChannels);
    return;
  }
  if (t.kind === 'palette') {
    const begin = t.beginC;
    const end = begin + t.numC - 1;
    checkEqualChannels(ch, begin, end, img.nbMetaChannels);
    if (begin >= img.nbMetaChannels) {
      img.nbMetaChannels++;
    } else {
      if (end >= img.nbMetaChannels) throw new Error('JXL: palette mixes meta and non-meta channels');
      img.nbMetaChannels += 2 - t.numC;
    }
    ch.splice(begin + 1, end - begin);
    // libjxl: the palette channel holds the nb_deltas delta entries followed by nb_colours colours.
    ch.unshift(emptyChannel(t.nbColours + t.nbDeltas, t.numC, -1, -1));
    return;
  }
  if (t.params.length === 0) t.params = defaultSqueezeParams(ch, img.nbMetaChannels);
  for (const p of t.params) {
    const begin = p.beginC;
    const end = begin + p.numC - 1;
    if (begin >= ch.length || end >= ch.length || end < begin) throw new Error('JXL: invalid squeeze channel range');
    if (begin < img.nbMetaChannels) {
      if (end >= img.nbMetaChannels) throw new Error('JXL: squeeze mixes meta and non-meta channels');
      if (!p.inPlace) throw new Error('JXL: meta channel squeeze must be in place');
      img.nbMetaChannels += p.numC;
    }
    const offset = p.inPlace ? end + 1 : ch.length;
    for (let c = begin; c <= end; c++) {
      const cc = ch[c]!;
      if (cc.hshift > 30 || cc.vshift > 30) throw new Error('JXL: too many squeezes');
      let w = cc.width;
      let h = cc.height;
      if (w === 0 || h === 0) throw new Error('JXL: squeezing empty channel');
      if (p.horizontal) {
        cc.width = (w + 1) >> 1;
        if (cc.hshift >= 0) cc.hshift++;
        w -= cc.width;
      } else {
        cc.height = (h + 1) >> 1;
        if (cc.vshift >= 0) cc.vshift++;
        h -= cc.height;
      }
      ch.splice(offset + (c - begin), 0, emptyChannel(w, h, cc.hshift, cc.vshift));
    }
  }
}

/** Undo all transforms in reverse order (libjxl Image::undo_transforms). */
export function applyInverseTransforms(img: ModularImage): void {
  for (let i = img.transforms.length - 1; i >= 0; i--) {
    const t = img.transforms[i]!;
    if (t.kind === 'rct') inverseRct(img.channels, t.beginC, t.rctType);
    else if (t.kind === 'palette') inversePalette(img, t);
    else inverseSqueeze(img, t.params);
  }
  img.transforms = [];
}

// ---------------------------------------------------------------------------------------------
// RCT (libjxl transform/rct.cc)

/** Inverse reversible colour transform on channels beginC..beginC+2. */
export function inverseRct(ch: ModularChannel[], beginC: number, rctType: number): void {
  checkEqualChannels(ch, beginC, beginC + 2);
  if (rctType === 0) return;
  const permutation = Math.floor(rctType / 7);
  const custom = rctType % 7;
  const c0 = ch[beginC]!;
  const c1 = ch[beginC + 1]!;
  const c2 = ch[beginC + 2]!;
  const a = c0.data;
  const b = c1.data;
  const c = c2.data;
  const n = c0.width * c0.height;
  if (custom === 6) {
    for (let i = 0; i < n; i++) {
      const Y = a[i]!;
      const Co = b[i]!;
      const Cg = c[i]!;
      const tmp = (Y - (Cg >> 1)) | 0;
      const G = (Cg + tmp) | 0;
      const B = (tmp - (Co >> 1)) | 0;
      a[i] = B + Co;
      b[i] = G;
      c[i] = B;
    }
  } else {
    const second = custom >> 1;
    const third = custom & 1;
    for (let i = 0; i < n; i++) {
      const first = a[i]!;
      let t = c[i]!;
      if (third) c[i] = t = (t + first) | 0;
      if (second === 1) b[i] = b[i]! + first;
      else if (second === 2) b[i] = b[i]! + ((first + t) >> 1);
    }
  }
  // Output k goes to channel beginC + perm[k].
  const datas = [a, b, c];
  ch[beginC + (permutation % 3)]!.data = datas[0]!;
  ch[beginC + ((permutation + 1 + Math.floor(permutation / 3)) % 3)]!.data = datas[1]!;
  ch[beginC + ((permutation + 2 - Math.floor(permutation / 3)) % 3)]!.data = datas[2]!;
}

// ---------------------------------------------------------------------------------------------
// Palette (libjxl transform/palette.{h,cc})

// prettier-ignore
const DELTA_PALETTE = new Int16Array([
  0, 0, 0, 4, 4, 4, 11, 0, 0, 0, 0, -13, 0, -12, 0, -10, -10, -10,
  -18, -18, -18, -27, -27, -27, -18, -18, 0, 0, 0, -32, -32, 0, 0, -37, -37, -37,
  0, -32, -32, 24, 24, 45, 50, 50, 50, -45, -24, -24, -24, -45, -45, 0, -24, -24,
  -34, -34, 0, -24, 0, -24, -45, -45, -24, 64, 64, 64, -32, 0, -32, 0, -32, 0,
  -32, 0, 32, -24, -45, -24, 45, 24, 45, 24, -24, -45, -45, -24, 24, 80, 80, 80,
  64, 0, 0, 0, 0, -64, 0, -64, -64, -24, -24, 45, 96, 96, 96, 64, 64, 0,
  45, -24, -24, 34, -34, 0, 112, 112, 112, 24, -45, -45, 45, 45, -24, 0, -32, 32,
  24, -24, 45, 0, 96, 96, 45, -24, 24, 24, -45, -24, -24, -45, 24, 0, -64, 0,
  96, 0, 0, 128, 128, 128, 64, 0, 64, 144, 144, 144, 96, 96, 0, -36, -36, 36,
  45, -24, -45, 45, -45, -24, 0, 0, -96, 0, 128, 128, 0, 96, 0, 45, 24, -45,
  -128, 0, 0, 24, -45, 24, -45, 24, -45, 64, 0, -64, 64, -64, -64, 96, 0, 96,
  45, -45, 24, 24, 45, -45, 64, 64, -64, 128, 128, 0, 0, 0, -128, -24, 45, -45,
]);
const LARGE_CUBE_OFFSET = 64;

/** Palette entry `index` for component `c`, including implicit / delta entries (libjxl GetPaletteValue). */
export function getPaletteValue(
  palette: Int32Array,
  index: number,
  c: number,
  paletteSize: number,
  bitDepth: number,
): number {
  if (index < 0) {
    if (c >= 3) return 0;
    let i = -(index + 1);
    i %= 143;
    let r = DELTA_PALETTE[((i + 1) >> 1) * 3 + c]!;
    if ((i & 1) === 0) r = -r;
    if (bitDepth > 8) r *= 2 ** (bitDepth - 8);
    return r;
  }
  if (index >= paletteSize) {
    if (c >= 3) return 0;
    let i = index - paletteSize;
    if (i < LARGE_CUBE_OFFSET) {
      i >>= c * 2;
      return (((i % 4) * (2 ** bitDepth - 1)) >> 2) + (1 << Math.max(0, bitDepth - 3));
    }
    i -= LARGE_CUBE_OFFSET;
    if (c === 1) i = Math.floor(i / 5);
    else if (c === 2) i = Math.floor(i / 25);
    return ((i % 5) * (2 ** bitDepth - 1)) >> 2;
  }
  return palette[c * paletteSize + index]!;
}

function inversePalette(img: ModularImage, t: Extract<TransformInfo, { kind: 'palette' }>): void {
  const ch = img.channels;
  if (img.nbMetaChannels < 1) throw new Error('JXL: palette transform without palette');
  const pal = ch[0]!;
  const nb = pal.height;
  const c0 = t.beginC + 1;
  const idxCh = ch[c0];
  if (!idxCh || nb < 1) throw new Error('JXL: corrupt palette transform');
  const { width: w, height: h } = idxCh;
  for (let i = 1; i < nb; i++) {
    ch.splice(c0 + 1, 0, {
      width: w,
      height: h,
      hshift: idxCh.hshift,
      vshift: idxCh.vshift,
      data: new Int32Array(w * h),
    });
  }
  const palette = pal.data;
  const paletteSize = pal.width;
  const bitDepth = Math.min(img.bitDepth, 24);
  const n = w * h;
  if (w === 0) {
    // nothing to do
  } else if (t.nbDeltas === 0 && t.dPred === Predictor.Zero) {
    const idx = idxCh.data;
    if (nb === 1) {
      for (let i = 0; i < n; i++) {
        let v = idx[i]!;
        if (v < 0) v = 0;
        else if (v >= paletteSize) v = paletteSize - 1;
        idx[i] = palette[v]!;
      }
    } else {
      for (let c = nb - 1; c >= 0; c--) {
        const out = ch[c0 + c]!.data;
        for (let i = 0; i < n; i++) out[i] = getPaletteValue(palette, idx[i]!, c, paletteSize, bitDepth);
      }
    }
  } else {
    const indices = idxCh.data.slice();
    for (let c = 0; c < nb; c++) {
      const out = ch[c0 + c]!.data;
      const wp = t.dPred === Predictor.Weighted ? new WpState(img.wpHeader, w) : null;
      for (let y = 0, i = 0; y < h; y++) {
        for (let x = 0; x < w; x++, i++) {
          const index = indices[i]!;
          const entry = getPaletteValue(palette, index, c, paletteSize, bitDepth);
          if (wp) {
            const pred = predictNoTree(out, w, x, y, t.dPred, wp);
            out[i] = index < t.nbDeltas ? pred + entry : entry;
            wp.update(out[i]!, x, y);
          } else {
            out[i] = index < t.nbDeltas ? predictNoTree(out, w, x, y, t.dPred, null) + entry : entry;
          }
        }
      }
    }
  }
  if (c0 >= img.nbMetaChannels) {
    img.nbMetaChannels--;
  } else {
    img.nbMetaChannels -= 2 - nb;
  }
  ch.shift();
}

// ---------------------------------------------------------------------------------------------
// Squeeze (libjxl transform/squeeze.{h,cc})

/** SmoothTendency(B, a, n) from libjxl squeeze.h; C integer division truncates. */
export function smoothTendency(B: number, a: number, n: number): number {
  let diff = 0;
  if (B >= a && a >= n) {
    diff = Math.trunc((4 * B - 3 * n - a + 6) / 12);
    if (diff - (diff & 1) > 2 * (B - a)) diff = 2 * (B - a) + 1;
    if (diff + (diff & 1) > 2 * (a - n)) diff = 2 * (a - n);
  } else if (B <= a && a <= n) {
    diff = Math.trunc((4 * B - 3 * n - a - 6) / 12);
    if (diff + (diff & 1) < 2 * (B - a)) diff = 2 * (B - a) - 1;
    if (diff - (diff & 1) < 2 * (a - n)) diff = 2 * (a - n);
  }
  return diff;
}

function invHSqueeze(ch: ModularChannel[], c: number, rc: number): void {
  const chin = ch[c]!;
  const res = ch[rc]!;
  if (chin.width !== (chin.width + res.width + 1) >> 1 || chin.height !== res.height || chin.hshift === 0) {
    throw new Error('JXL: corrupt squeeze');
  }
  const newHshift = chin.hshift > 0 ? chin.hshift - 1 : chin.hshift;
  if (res.width === 0) {
    chin.hshift = newHshift;
    return;
  }
  const ow = chin.width + res.width;
  const out = new Int32Array(ow * chin.height);
  const inp = chin.data;
  const rd = res.data;
  const iw = chin.width;
  const rw = res.width;
  for (let y = 0; y < res.height; y++) {
    const ib = y * iw;
    const rb = y * rw;
    const ob = y * ow;
    for (let x = 0; x < rw; x++) {
      const avg = inp[ib + x]!;
      const nextAvg = x + 1 < iw ? inp[ib + x + 1]! : avg;
      const left = x ? out[ob + 2 * x - 1]! : avg;
      const diff = rd[rb + x]! + smoothTendency(left, avg, nextAvg);
      const A = avg + Math.trunc(diff / 2);
      out[ob + 2 * x] = A;
      out[ob + 2 * x + 1] = A - diff;
    }
    if (ow & 1) out[ob + ow - 1] = inp[ib + iw - 1]!;
  }
  ch[c] = { width: ow, height: chin.height, hshift: newHshift, vshift: chin.vshift, data: out };
}

function invVSqueeze(ch: ModularChannel[], c: number, rc: number): void {
  const chin = ch[c]!;
  const res = ch[rc]!;
  if (chin.height !== (chin.height + res.height + 1) >> 1 || chin.width !== res.width || chin.vshift === 0) {
    throw new Error('JXL: corrupt squeeze');
  }
  const newVshift = chin.vshift > 0 ? chin.vshift - 1 : chin.vshift;
  if (res.height === 0) {
    chin.vshift = newVshift;
    return;
  }
  const w = chin.width;
  const oh = chin.height + res.height;
  const out = new Int32Array(w * oh);
  const inp = chin.data;
  const rd = res.data;
  for (let y = 0; y < res.height; y++) {
    const ab = y * w;
    const nb = (y + 1 < chin.height ? y + 1 : y) * w;
    const ob = 2 * y * w;
    const pb = y > 0 ? ob - w : -1;
    for (let x = 0; x < w; x++) {
      const avg = inp[ab + x]!;
      const nextAvg = inp[nb + x]!;
      const top = pb >= 0 ? out[pb + x]! : avg;
      const diff = rd[ab + x]! + smoothTendency(top, avg, nextAvg);
      const o = avg + Math.trunc(diff / 2);
      out[ob + x] = o;
      out[ob + w + x] = o - diff;
    }
  }
  if (oh & 1) out.set(inp.subarray((chin.height - 1) * w, chin.height * w), (oh - 1) * w);
  ch[c] = { width: w, height: oh, hshift: chin.hshift, vshift: newVshift, data: out };
}

function inverseSqueeze(img: ModularImage, params: SqueezeParams[]): void {
  const ch = img.channels;
  for (let i = params.length - 1; i >= 0; i--) {
    const p = params[i]!;
    const begin = p.beginC;
    const end = begin + p.numC - 1;
    if (begin >= ch.length || end >= ch.length || end < begin) throw new Error('JXL: invalid squeeze channel range');
    const offset = p.inPlace ? end + 1 : ch.length + begin - end - 1;
    if (begin < img.nbMetaChannels) img.nbMetaChannels -= p.numC;
    for (let c = begin; c <= end; c++) {
      const rc = offset + c - begin;
      const a = ch[c]!;
      const r = ch[rc];
      if (!r || a.width < r.width || a.height < r.height) throw new Error('JXL: corrupt squeeze transform');
      if (p.horizontal) invHSqueeze(ch, c, rc);
      else invVSqueeze(ch, c, rc);
    }
    ch.splice(offset, p.numC);
  }
}
