/**
 * JPEG XL frame features coded in LfGlobal (ISO/IEC 18181-1 G.1, K.3–K.5): the patch dictionary, splines
 * and noise, plus their rendering. Parse in spec order: readPatches, readSplines, readNoiseParams.
 * Reference: libjxl lib/jxl/dec_patch_dictionary.cc, splines.cc, dec_noise.cc, xorshift128plus-inl.h,
 * render_pipeline/stage_noise.cc, base/fast_math-inl.h.
 */
import { type JxlBitReader, unpackSigned } from './jxlBitReader.js';
import { JxlEntropyDecoder } from './jxlEntropy.js';
import { frameDimensions, type JxlFrameHeader } from './jxlFrameHeader.js';
import type { JxlExtraChannelInfo, JxlImageHeader } from './jxlImageHeader.js';
import {
  blendPixels,
  type JxlPatchBlending,
  type JxlReferenceFrame,
  PATCH_ALPHA_WEIGHTED_ADD_BELOW,
  PATCH_MUL,
} from './jxlRender.js';
import { mirrorCoord } from './jxlRestoration.js';

// ---------------------------------------------------------------------------------------------
// Patches (dec_patch_dictionary.cc)

export interface JxlPatch {
  /** Reference slot 0..3 and the source rectangle in that reference frame. */
  ref: number;
  refX0: number;
  refY0: number;
  width: number;
  height: number;
  /** Destination position in the (pre-upsampling) frame. */
  x: number;
  y: number;
  /** [color, ...extra channels]. */
  blending: JxlPatchBlending[];
}

export type JxlPatches = JxlPatch[];

const usesAlpha = (mode: number) => mode >= 4;

/** PatchDictionary::Decode. Positions are in coded frame samples (before upsampling). */
export function readPatches(br: JxlBitReader, image: JxlImageHeader, fh: JxlFrameHeader): JxlPatches {
  const numEc = image.extraChannels.length;
  const d = frameDimensions(fh);
  const xsize = fh.encoding === 'vardct' ? d.xsizeBlocks * 8 : d.width;
  const ysize = fh.encoding === 'vardct' ? d.ysizeBlocks * 8 : d.height;
  const dec = JxlEntropyDecoder.read(br, 10);
  const read = (ctx: number) => dec.readUint(br, ctx);
  const maxRefPatches = 1024 + Math.floor((xsize * ysize) / 4);
  const maxPatches = maxRefPatches * 4;
  const numRef = read(0);
  if (numRef > maxRefPatches) throw new Error('JXL: too many patches in dictionary');
  const patches: JxlPatches = [];
  for (let id = 0; id < numRef; id++) {
    const ref = read(1);
    if (ref >= 4) throw new Error('JXL: invalid patch reference frame');
    const refX0 = read(3);
    const refY0 = read(3);
    const width = read(2) + 1;
    const height = read(2) + 1;
    const count = read(7) + 1;
    if (count > maxPatches || patches.length + count > maxPatches) throw new Error('JXL: too many patches');
    for (let i = 0; i < count; i++) {
      let x: number;
      let y: number;
      if (i === 0) {
        x = read(4);
        y = read(4);
      } else {
        const prev = patches[patches.length - 1]!;
        x = prev.x + unpackSigned(read(6));
        y = prev.y + unpackSigned(read(6));
        if (x < 0 || y < 0) throw new Error('JXL: negative patch position');
      }
      if (x + width > xsize || y + height > ysize) throw new Error('JXL: patch outside the frame');
      const blending: JxlPatchBlending[] = [];
      for (let j = 0; j <= numEc; j++) {
        const mode = read(5);
        if (mode > PATCH_ALPHA_WEIGHTED_ADD_BELOW) throw new Error(`JXL: invalid patch blend mode ${mode}`);
        let alphaChannel = 0;
        if (usesAlpha(mode) && numEc > 1) {
          alphaChannel = read(8);
          if (alphaChannel >= numEc) throw new Error('JXL: invalid patch alpha channel');
        }
        const clamp = usesAlpha(mode) || mode === PATCH_MUL ? read(9) !== 0 : false;
        blending.push({ mode, alphaChannel, clamp });
      }
      patches.push({ ref, refX0, refY0, width, height, x, y, blending });
    }
  }
  dec.finish();
  return patches;
}

/**
 * Apply patches in place (PatchDictionary::AddOneRow, in patch order) to frame-sized planes
 * [3 color, ...extra channels] of `width` x `height` (before upsampling, before the color transform).
 * Reference frames must have been saved before the color transform.
 */
export function applyPatches(
  planes: readonly Float32Array[],
  width: number,
  height: number,
  patches: JxlPatches,
  references: readonly (JxlReferenceFrame | undefined)[],
  ecInfo: readonly JxlExtraChannelInfo[],
): void {
  const tmp = new Float32Array(planes.length);
  for (const p of patches) {
    const ref = references[p.ref];
    if (!ref || ref.width === 0) throw new Error('JXL: patch references an empty frame');
    if (!ref.savedBeforeCt) throw new Error('JXL: patches cannot use frames saved after the color transform');
    if (p.refX0 + p.width > ref.width || p.refY0 + p.height > ref.height) {
      throw new Error('JXL: patch outside its reference frame');
    }
    const w = Math.min(p.width, width - p.x);
    for (let iy = 0; iy < p.height && p.y + iy < height; iy++) {
      const off = (p.y + iy) * width + p.x;
      const refOff = (p.refY0 + iy) * ref.width + p.refX0;
      blendPixels(planes, off, ref.planes, refOff, planes, off, w, p.blending, ecInfo, tmp);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Splines (splines.cc)

export interface JxlQuantizedSpline {
  /** Delta-of-delta control point offsets [dx0, dy0, dx1, dy1, ...] after the starting point. */
  controlPoints: number[];
  /** Quantized DCT32 of X, Y, B. */
  colorDct: Int32Array[];
  sigmaDct: Int32Array;
}

export interface JxlSplines {
  quantAdjustment: number;
  /** Starting point (x, y) per spline. */
  startingPoints: [number, number][];
  splines: JxlQuantizedSpline[];
  /** Upsampled frame area, for libjxl's rendering-area limit. */
  imageSize: number;
}

/** Splines::Decode (6 contexts). */
export function readSplines(br: JxlBitReader, fh: JxlFrameHeader): JxlSplines {
  const d = frameDimensions(fh);
  const dec = JxlEntropyDecoder.read(br, 6);
  const read = (ctx: number) => dec.readUint(br, ctx);
  const maxControlPoints = Math.min(1 << 20, Math.floor((d.width * d.height) / 2));
  const numSplines = read(2) + 1;
  if (numSplines > maxControlPoints) throw new Error('JXL: too many splines');
  const startingPoints: [number, number][] = [];
  for (let i = 0; i < numSplines; i++) {
    const dx = read(1);
    const dy = read(1);
    const prev = startingPoints[i - 1];
    const p: [number, number] = prev ? [prev[0] + unpackSigned(dx), prev[1] + unpackSigned(dy)] : [dx, dy];
    validatePos(p[0], p[1]);
    startingPoints.push(p);
  }
  const quantAdjustment = unpackSigned(read(0));
  let totalControlPoints = numSplines;
  const splines: JxlQuantizedSpline[] = [];
  const readDct = () => {
    const dct = new Int32Array(32);
    for (let i = 0; i < 32; i++) {
      const v = unpackSigned(read(5));
      if (v === -(2 ** 31)) throw new Error('JXL: invalid spline DCT value');
      dct[i] = v;
    }
    return dct;
  };
  for (let s = 0; s < numSplines; s++) {
    const n = read(3);
    totalControlPoints += n;
    if (n > maxControlPoints || totalControlPoints > maxControlPoints) throw new Error('JXL: too many control points');
    const controlPoints: number[] = [];
    for (let i = 0; i < 2 * n; i++) {
      const v = unpackSigned(read(4));
      if (Math.abs(v) >= 2 ** 30) throw new Error('JXL: spline delta-delta out of bounds');
      controlPoints.push(v);
    }
    const colorDct = [readDct(), readDct(), readDct()];
    splines.push({ controlPoints, colorDct, sigmaDct: readDct() });
  }
  dec.finish();
  return { quantAdjustment, startingPoints, splines, imageSize: d.upsampledWidth * d.upsampledHeight };
}

function validatePos(x: number, y: number): void {
  const lim = 2 ** 23;
  if (Math.abs(x) >= lim || Math.abs(y) >= lim) throw new Error('JXL: spline coordinates out of bounds');
}

const CHANNEL_WEIGHT = [0.0042, 0.075, 0.07, 0.3333];
const SQRT0_5 = Math.SQRT1_2;

/** A dequantized spline (libjxl Spline): control points and DCT32 of X, Y, B, sigma. */
export interface JxlSpline {
  points: [number, number][];
  colorDct: Float32Array[];
  sigmaDct: Float32Array;
}

/** QuantizedSpline::Dequantize, including its area-limit check (`area` accumulates across splines). */
export function dequantizeSpline(
  q: JxlQuantizedSpline,
  start: [number, number],
  quantAdjustment: number,
  yToX: number,
  yToB: number,
  imageSize: number,
  area: { total: number },
): JxlSpline {
  const areaLimit = Math.min(1024 * imageSize + 2 ** 32, 2 ** 42);
  let x = Math.round(start[0]);
  let y = Math.round(start[1]);
  validatePos(x, y);
  const points: [number, number][] = [[x, y]];
  let ddx = 0;
  let ddy = 0;
  let manhattan = 0;
  for (let i = 0; i < q.controlPoints.length; i += 2) {
    ddx += q.controlPoints[i]!;
    ddy += q.controlPoints[i + 1]!;
    validatePos(ddx, ddy);
    manhattan += Math.abs(ddx) + Math.abs(ddy);
    if (manhattan > areaLimit) throw new Error('JXL: spline too long');
    x += ddx;
    y += ddy;
    validatePos(x, y);
    points.push([x, y]);
  }
  const invQuant = quantAdjustment >= 0 ? 1 / (1 + 0.125 * quantAdjustment) : 1 - 0.125 * quantAdjustment;
  const colorDct = [new Float32Array(32), new Float32Array(32), new Float32Array(32)];
  const sigmaDct = new Float32Array(32);
  const color = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const src = q.colorDct[c]!;
    const dst = colorDct[c]!;
    for (let i = 0; i < 32; i++) {
      dst[i] = src[i]! * (i === 0 ? SQRT0_5 : 1) * CHANNEL_WEIGHT[c]! * invQuant;
      // Rendering-area estimate (libjxl limits it to avoid pathological decode times).
      color[c]! += Math.ceil(invQuant * Math.abs(src[i]!));
    }
  }
  const [cx, cy, cb] = [colorDct[0]!, colorDct[1]!, colorDct[2]!];
  for (let i = 0; i < 32; i++) {
    cx[i]! += yToX * cy[i]!;
    cb[i]! += yToB * cy[i]!;
  }
  color[0]! += Math.ceil(Math.abs(yToX)) * color[1]!;
  color[2]! += Math.ceil(Math.abs(yToB)) * color[1]!;
  const maxColor = Math.max(...color);
  const logColor = Math.max(1, Math.ceil(Math.log2(1 + maxColor)));
  const weightLimit = Math.ceil(Math.sqrt(areaLimit / logColor / Math.max(1, manhattan)));
  let widthEstimate = 0;
  for (let i = 0; i < 32; i++) {
    sigmaDct[i] = q.sigmaDct[i]! * (i === 0 ? SQRT0_5 : 1) * CHANNEL_WEIGHT[3]! * invQuant;
    const weight = Math.floor(Math.min(weightLimit, Math.max(1, Math.ceil(invQuant * Math.abs(q.sigmaDct[i]!)))));
    widthEstimate += weight * weight * logColor;
  }
  area.total += widthEstimate * manhattan;
  if (area.total > areaLimit) throw new Error('JXL: total spline area too large');
  return { points, colorDct, sigmaDct };
}

/** libjxl FastCosf (fast_math-inl.h), L1 error 7e-5. */
export function fastCos(x: number): number {
  const pi2 = Math.PI * 2;
  const xmod = x - Math.floor(x * (0.5 / Math.PI)) * pi2;
  const xPi = Math.min(xmod, pi2 - xmod);
  const above = xPi >= Math.PI / 2;
  const xs = (above ? Math.PI - xPi : xPi) * 0.25;
  const x2 = xs * xs;
  const pre = x2 * x2 * 0.06960438 + (x2 * -0.84087373 + 1.68179268);
  const s1 = pre * pre - Math.SQRT2;
  const s2 = s1 * s1 - 1;
  return above ? -s2 : s2;
}

/** libjxl FastErff, L1 error 7e-4. */
export function fastErf(x: number): number {
  const a = Math.abs(x);
  const d = ((((a * 7.77394369e-2 + 2.05260015e-4) * a + 2.32120216e-1) * a + 2.77820801e-1) * a + 1) ** 2;
  const r = 1 - 1 / (d * d);
  return x <= 0 ? -r : r;
}

/** ContinuousIDCT: cosine interpolation of a DCT32 at t in [0, 31]. */
export function continuousIdct(dct: ArrayLike<number>, t: number): number {
  let sum = 0;
  for (let i = 0; i < 32; i++) sum += Math.SQRT2 * dct[i]! * fastCos((Math.PI / 32) * i * (t + 0.5));
  return sum;
}

const lerp = (a: [number, number], b: [number, number], f: number): [number, number] => [
  a[0] + f * (b[0] - a[0]),
  a[1] + f * (b[1] - a[1]),
];

/** DrawCentripetalCatmullRomSpline: 16 points per control-point interval. */
export function catmullRomPoints(control: readonly [number, number][]): [number, number][] {
  if (control.length <= 1) return control.map((p) => [p[0], p[1]]);
  const first = control[0]!;
  const second = control[1]!;
  const last = control[control.length - 1]!;
  const beforeLast = control[control.length - 2]!;
  const p: [number, number][] = [
    [2 * first[0] - second[0], 2 * first[1] - second[1]],
    ...control,
    [2 * last[0] - beforeLast[0], 2 * last[1] - beforeLast[1]],
  ];
  const out: [number, number][] = [];
  for (let s = 0; s + 3 < p.length; s++) {
    const q = [p[s]!, p[s + 1]!, p[s + 2]!, p[s + 3]!];
    out.push(q[1]!);
    const d = [0, 1, 2].map((k) => Math.sqrt(Math.hypot(q[k + 1]![0] - q[k]![0], q[k + 1]![1] - q[k]![1])));
    const t = [0, d[0]!, d[0]! + d[1]!];
    for (let i = 1; i < 16; i++) {
      const tt = d[0]! + (i / 16) * d[1]!;
      const a = [0, 1, 2].map((k) => lerp(q[k]!, q[k + 1]!, (tt - t[k]!) / d[k]!));
      const b = [0, 1].map((k) => lerp(a[k]!, a[k + 1]!, (tt - t[k]!) / (d[k]! + d[k + 1]!)));
      out.push(lerp(b[0]!, b[1]!, (tt - t[1]!) / d[1]!));
    }
  }
  out.push(p[p.length - 2]!);
  return out;
}

/** ForEachEquallySpacedPoint: points 1px apart along the polyline, each with its distance to the previous. */
export function equallySpacedPoints(points: readonly [number, number][]): [number, number, number][] {
  const out: [number, number, number][] = [];
  let current = points[0]!;
  out.push([current[0], current[1], 1]);
  let next = 0;
  while (next < points.length) {
    let previous = current;
    let fromPrevious = 0;
    for (;;) {
      if (next === points.length) {
        out.push([previous[0], previous[1], fromPrevious]);
        return out;
      }
      const n = points[next]!;
      const toNext = Math.sqrt((n[0] - previous[0]) ** 2 + (n[1] - previous[1]) ** 2);
      if (fromPrevious + toNext >= 1) {
        const f = (1 - fromPrevious) / toNext;
        current = [previous[0] + f * (n[0] - previous[0]), previous[1] + f * (n[1] - previous[1])];
        out.push([current[0], current[1], 1]);
        break;
      }
      fromPrevious += toNext;
      previous = n;
      next++;
    }
  }
  return out;
}

/** std::llround: round half away from zero. */
const llround = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

/** Draw one Gaussian segment (ComputeSegments + DrawSegment) onto the 3 planes. */
function drawSegment(
  planes: readonly Float32Array[],
  width: number,
  height: number,
  cx: number,
  cy: number,
  intensity: number,
  color: readonly number[],
  sigma: number,
): void {
  if (!(Number.isFinite(sigma) && sigma !== 0 && Number.isFinite(1 / sigma) && Number.isFinite(intensity))) return;
  let maxColor = 0.01;
  for (let c = 0; c < 3; c++) maxColor = Math.max(maxColor, Math.abs(color[c]! * intensity));
  // Distance beyond which max_color * exp(-d^2 / (2 sigma^2)) < 1e-5 (kDistanceExp = 5, JXL_HIGH_PRECISION).
  const maxDist = Math.sqrt(-2 * sigma * sigma * (Math.log(0.1) * 5 - Math.log(maxColor)));
  const y0 = Math.max(0, llround(cy - maxDist));
  const y1 = Math.min(height, llround(cy + maxDist) + 1);
  const xs = llround(cx - maxDist);
  const xe = llround(cx + maxDist);
  if (xe < 0 || xs >= width) return;
  const x0 = Math.max(0, xs);
  const x1 = Math.min(width, xe + 1);
  const invSigma = 1 / sigma;
  const scale = 0.25 * sigma * intensity;
  for (let y = y0; y < y1; y++) {
    const dy = y - cy;
    for (let x = x0; x < x1; x++) {
      const dx = x - cx;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const f = fastErf((dist * 0.5 + 0.353553391) * invSigma) - fastErf((dist * 0.5 - 0.353553391) * invSigma);
      const v = scale * f * f;
      const i = y * width + x;
      for (let c = 0; c < 3; c++) planes[c]![i]! += color[c]! * v;
    }
  }
}

/**
 * Splines::InitializeDrawCache + AddTo: render every spline additively onto the X, Y, B planes
 * (frame-sized, before upsampling and before the XYB/color transform). yToX / yToB are the base
 * color correlation factors (VarDCT LfGlobal; 0 and 1 for Modular frames).
 */
export function drawSplines(
  planes: readonly [Float32Array, Float32Array, Float32Array],
  width: number,
  height: number,
  splines: JxlSplines,
  { yToX = 0, yToB = 1 }: { yToX?: number; yToB?: number } = {},
): void {
  const area = { total: 0 };
  const deq = splines.splines.map((q, i) =>
    dequantizeSpline(q, splines.startingPoints[i]!, splines.quantAdjustment, yToX, yToB, splines.imageSize, area),
  );
  for (const s of deq) {
    for (let i = 1; i < s.points.length; i++) {
      if (s.points[i]![0] === s.points[i - 1]![0] && s.points[i]![1] === s.points[i - 1]![1]) {
        throw new Error('JXL: identical successive spline control points');
      }
    }
  }
  const color = [0, 0, 0];
  for (const s of deq) {
    const pts = equallySpacedPoints(catmullRomPoints(s.points));
    const arcLength = pts.length - 2 + pts[pts.length - 1]![2];
    if (arcLength <= 0) continue;
    const invArc = 1 / arcLength;
    for (let k = 0; k < pts.length; k++) {
      const [x, y, multiplier] = pts[k]!;
      const t = 31 * Math.min(1, k * invArc);
      for (let c = 0; c < 3; c++) color[c] = continuousIdct(s.colorDct[c]!, t);
      drawSegment(planes, width, height, x, y, multiplier, color, continuousIdct(s.sigmaDct, t));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Noise (dec_noise.cc, stage_noise.cc)

/** 8-point noise strength LUT. */
export type JxlNoiseParams = Float32Array;

/** DecodeNoise: 8 x u(10) / 1024. */
export function readNoiseParams(br: JxlBitReader): JxlNoiseParams {
  const lut = new Float32Array(8);
  for (let i = 0; i < 8; i++) lut[i] = br.readBits(10) / 1024;
  return lut;
}

const M64 = (1n << 64n) - 1n;
function splitMix64(z: bigint): bigint {
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
  return z ^ (z >> 31n);
}
const GOLDEN = 0x9e3779b97f4a7c15n;

/** libjxl Xorshift128Plus: 8 independent 64-bit lanes, state kept as 32-bit halves. */
export class JxlXorshift128Plus {
  /** s0 / s1 lanes as [hi, lo] pairs. */
  private readonly s0 = new Uint32Array(16);
  private readonly s1 = new Uint32Array(16);

  /** Single-seed form (as in xorshift128plus_test.cc), or the 4 x 32-bit seed form used for noise. */
  constructor(seed1: number, seed2?: number, seed3?: number, seed4?: number) {
    const s0: bigint[] = [];
    const s1: bigint[] = [];
    if (seed2 === undefined) {
      s0.push(splitMix64((BigInt(seed1) + GOLDEN) & M64));
      s1.push(splitMix64(s0[0]!));
      for (let i = 1; i < 8; i++) {
        s0.push(splitMix64(s1[i - 1]!));
        s1.push(splitMix64(s0[i]!));
      }
    } else {
      s0.push(splitMix64(((BigInt(seed1) << 32n) + BigInt(seed2) + GOLDEN) & M64));
      s1.push(splitMix64(((BigInt(seed3!) << 32n) + BigInt(seed4!) + GOLDEN) & M64));
      for (let i = 1; i < 8; i++) {
        s0.push(splitMix64(s0[i - 1]!));
        s1.push(splitMix64(s1[i - 1]!));
      }
    }
    for (let i = 0; i < 8; i++) {
      this.s0[2 * i] = Number(s0[i]! >> 32n);
      this.s0[2 * i + 1] = Number(s0[i]! & 0xffffffffn);
      this.s1[2 * i] = Number(s1[i]! >> 32n);
      this.s1[2 * i + 1] = Number(s1[i]! & 0xffffffffn);
    }
  }

  /** Fill(): 8 x 64-bit outputs, written as 16 little-endian 32-bit words (lo, hi per lane). */
  next(out: Uint32Array): void {
    const { s0: S0, s1: S1 } = this;
    for (let i = 0; i < 8; i++) {
      let ah = S0[2 * i]!; // s1 (named as in libjxl)
      let al = S0[2 * i + 1]!;
      const bh = S1[2 * i]!; // s0
      const bl = S1[2 * i + 1]!;
      const sumL = (al + bl) >>> 0;
      out[2 * i] = sumL;
      out[2 * i + 1] = (ah + bh + (sumL < al ? 1 : 0)) >>> 0;
      S0[2 * i] = bh;
      S0[2 * i + 1] = bl;
      // s1 ^= s1 << 23
      ah = (ah ^ ((ah << 23) | (al >>> 9))) >>> 0;
      al = (al ^ (al << 23)) >>> 0;
      // s1 ^= s0 ^ (s1 >> 18) ^ (s0 >> 5)
      const r18h = ah >>> 18;
      const r18l = ((al >>> 18) | (ah << 14)) >>> 0;
      const r5h = bh >>> 5;
      const r5l = ((bl >>> 5) | (bh << 27)) >>> 0;
      S1[2 * i] = (ah ^ bh ^ r18h ^ r5h) >>> 0;
      S1[2 * i + 1] = (al ^ bl ^ r18l ^ r5l) >>> 0;
    }
  }
}

const bitsU32 = new Uint32Array(16);
const bitsF32 = new Float32Array(1);
const bitsF32U = new Uint32Array(bitsF32.buffer);

/** RandomImage: fill a w x h tile (row stride `stride`, at `off`) with floats in [1, 2). */
function randomTile(rng: JxlXorshift128Plus, out: Float32Array, off: number, stride: number, w: number, h: number) {
  for (let y = 0; y < h; y++) {
    const row = off + y * stride;
    let x = 0;
    for (;;) {
      rng.next(bitsU32);
      const last = x + 16 >= w;
      const end = last ? w : x + 16;
      for (let i = 0; x < end; i++, x++) {
        bitsF32U[0] = (bitsU32[i]! >>> 9) | 0x3f800000;
        out[row + x] = bitsF32[0]!;
      }
      if (last) break;
    }
  }
}

/** Random3Planes for every group_dim tile of the (upsampled) frame, seeded as libjxl PrepareNoiseInput. */
export function randomNoisePlanes(
  width: number,
  height: number,
  groupDim: number,
  visibleFrameIndex: number,
  nonvisibleFrameIndex: number,
): [Float32Array, Float32Array, Float32Array] {
  const planes: [Float32Array, Float32Array, Float32Array] = [
    new Float32Array(width * height),
    new Float32Array(width * height),
    new Float32Array(width * height),
  ];
  for (let y0 = 0; y0 < height; y0 += groupDim) {
    for (let x0 = 0; x0 < width; x0 += groupDim) {
      const rng = new JxlXorshift128Plus(visibleFrameIndex, nonvisibleFrameIndex, x0, y0);
      const w = Math.min(groupDim, width - x0);
      const h = Math.min(groupDim, height - y0);
      for (const p of planes) randomTile(rng, p, y0 * width + x0, width, w, h);
    }
  }
  return planes;
}

/** ConvolveNoiseStage: 0.16 * (sum of the other 24 samples of the 5x5) - 3.84 * center, mirrored borders. */
export function convolveNoise(src: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  const xi = new Int32Array(width + 4);
  for (let x = -2; x < width + 2; x++) xi[x + 2] = mirrorCoord(x, width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const row = mirrorCoord(y + dy, height) * width;
        for (let dx = 0; dx < 5; dx++) sum += src[row + xi[x + dx]!]!;
      }
      const center = src[y * width + x]!;
      out[y * width + x] = (sum - center) * 0.16 - 3.84 * center;
    }
  }
  return out;
}

/** StrengthEvalLut + NoiseStrength: piecewise-linear LUT over x in [0, 1] (6 intervals), clamped to [0, 1]. */
export function noiseStrength(lut: JxlNoiseParams, x: number): number {
  const scaled = Math.max(0, x * 6);
  let fl = Math.floor(scaled);
  let frac = scaled - fl;
  if (scaled >= 7) {
    fl = 6;
    frac = 1;
  }
  const v = (lut[fl + 1]! - lut[fl]!) * frac + lut[fl]!;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface JxlNoiseOptions {
  /** Frame counters from advanceFrameIndices (libjxl visible/nonvisible_frame_index). */
  visibleFrameIndex: number;
  nonvisibleFrameIndex: number;
  /** Group dimension of the frame (frameDimensions(fh).groupDim). */
  groupDim: number;
  /** Base color correlation (VarDCT LfGlobal; 0 and 1 for Modular). */
  yToX?: number;
  yToB?: number;
}

/**
 * Add photon noise in place to the X, Y, B planes of the upsampled frame (ConvolveNoiseStage +
 * AddNoiseStage), before the color transform.
 */
export function renderNoise(
  planes: readonly [Float32Array, Float32Array, Float32Array],
  width: number,
  height: number,
  params: JxlNoiseParams,
  { visibleFrameIndex, nonvisibleFrameIndex, groupDim, yToX = 0, yToB = 1 }: JxlNoiseOptions,
): void {
  if (!params.some((v) => Math.abs(v) > 1e-3)) return;
  const rnd = randomNoisePlanes(width, height, groupDim, visibleFrameIndex, nonvisibleFrameIndex).map((p) =>
    convolveNoise(p, width, height),
  );
  const [rr, rg, rc] = [rnd[0]!, rnd[1]!, rnd[2]!];
  const [px, py, pb] = planes;
  for (let i = 0; i < width * height; i++) {
    const vx = px[i]!;
    const vy = py[i]!;
    const strengthG = noiseStrength(params, (vy - vx) * 0.5);
    const strengthR = noiseStrength(params, (vy + vx) * 0.5);
    const cor = rc[i]! * 0.22 * 0.9921875;
    const red = strengthR * (0.0078125 * rr[i]! * 0.22 + cor);
    const green = strengthG * (0.0078125 * rg[i]! * 0.22 + cor);
    const rgNoise = red + green;
    px[i] = vx + yToX * rgNoise + red - green;
    py[i] = vy + rgNoise;
    pb[i] = pb[i]! + yToB * rgNoise;
  }
}
