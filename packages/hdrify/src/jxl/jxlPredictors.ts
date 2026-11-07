/**
 * Modular predictors and the self-correcting weighted predictor (ISO/IEC 18181-1 Annex H.4/H.5).
 * Port of libjxl lib/jxl/modular/encoding/context_predict.h (cross-checked against jxl-oxide
 * crates/jxl-modular/src/predictor.rs).
 *
 * Samples are int32 (libjxl `pixel_type`); intermediate arithmetic that libjxl does in int64
 * (`pixel_type_w`) is done with JS numbers, which are exact for the magnitudes involved (< 2^53).
 */
import type { JxlBitReader } from './jxlBitReader.js';

/** Predictor ids (spec Table H.2). */
export const Predictor = {
  Zero: 0,
  Left: 1,
  Top: 2,
  Average0: 3,
  Select: 4,
  Gradient: 5,
  Weighted: 6,
  TopRight: 7,
  TopLeft: 8,
  LeftLeft: 9,
  Average1: 10,
  Average2: 11,
  Average3: 12,
  Average4: 13,
} as const;
export const NUM_PREDICTORS = 14;

/** Weighted predictor parameters (spec H.5.1 / libjxl weighted::Header). */
export interface WpHeader {
  p1C: number;
  p2C: number;
  p3Ca: number;
  p3Cb: number;
  p3Cc: number;
  p3Cd: number;
  p3Ce: number;
  w: [number, number, number, number];
}

export function defaultWpHeader(): WpHeader {
  return { p1C: 16, p2C: 10, p3Ca: 7, p3Cb: 7, p3Cc: 7, p3Cd: 0, p3Ce: 0, w: [13, 12, 12, 12] };
}

export function readWpHeader(br: JxlBitReader): WpHeader {
  if (br.readBool()) return defaultWpHeader();
  const p1C = br.readBits(5);
  const p2C = br.readBits(5);
  const p3Ca = br.readBits(5);
  const p3Cb = br.readBits(5);
  const p3Cc = br.readBits(5);
  const p3Cd = br.readBits(5);
  const p3Ce = br.readBits(5);
  const w: [number, number, number, number] = [br.readBits(4), br.readBits(4), br.readBits(4), br.readBits(4)];
  return { p1C, p2C, p3Ca, p3Cb, p3Cc, p3Cd, p3Ce, w };
}

/** ClampedGradient (libjxl context_predict.h): n + w - nw clamped to [min(n, w), max(n, w)]. */
export function clampedGradient(n: number, w: number, nw: number): number {
  const m = n < w ? n : w;
  const M = n < w ? w : n;
  if (nw < m) return M;
  if (nw > M) return m;
  return n + w - nw;
}

/**
 * Prediction for one predictor given the (edge-resolved) neighbours (libjxl PredictOne).
 * Divisions truncate toward zero as in C.
 */
export function predictOne(
  p: number,
  left: number,
  top: number,
  toptop: number,
  topleft: number,
  topright: number,
  leftleft: number,
  toprightright: number,
  wpPred: number,
): number {
  switch (p) {
    case 0: // Zero
      return 0;
    case 1: // Left
      return left;
    case 2: // Top
      return top;
    case 3: // Average0
      return Math.trunc((left + top) / 2);
    case 4: // Select
      return Math.abs(top - topleft) < Math.abs(left - topleft) ? left : top;
    case 5: // Gradient
      return clampedGradient(left, top, topleft);
    case 6: // Weighted
      return wpPred;
    case 7: // TopRight
      return topright;
    case 8: // TopLeft
      return topleft;
    case 9: // LeftLeft
      return leftleft;
    case 10: // Average1
      return Math.trunc((left + topleft) / 2);
    case 11: // Average2
      return Math.trunc((topleft + top) / 2);
    case 12: // Average3
      return Math.trunc((top + topright) / 2);
    case 13: // Average4
      return Math.trunc((6 * top - 2 * toptop + 7 * left + leftleft + toprightright + 3 * topright + 8) / 16);
    default:
      throw new Error(`JXL: invalid predictor ${p}`);
  }
}

/** divlookup[i] = 2^24 / (i + 1) (libjxl weighted::State::divlookup). */
const DIV_LOOKUP = /* @__PURE__ */ (() => {
  const t = new Uint32Array(64);
  for (let i = 0; i < 64; i++) t[i] = Math.floor(16777216 / (i + 1));
  return t;
})();

const TWO24 = 16777216;

/** floor(s * d / 2^24) exactly for |s| up to ~2^52 and d ≤ 2^24 (libjxl does this in int64). */
function mulShift24(s: number, d: number): number {
  const hi = Math.floor(s / TWO24);
  const lo = s - hi * TWO24;
  return hi * d + Math.floor((lo * d) / TWO24);
}

function floorLog2(x: number): number {
  return x > 0xffffffff ? 32 : 31 - Math.clz32(x);
}

/**
 * Self-correcting (weighted) predictor state for one channel (libjxl weighted::State).
 * Error rows are kept in two alternating halves of size (width + 2).
 */
export class WpState {
  private readonly hdr: WpHeader;
  private readonly width: number;
  private readonly predErr: [Uint32Array, Uint32Array, Uint32Array, Uint32Array];
  private readonly error: Int32Array;
  private readonly prediction = new Float64Array(4);
  private readonly weights = new Uint32Array(4);
  /** Prediction scaled by 8, before rounding (libjxl `pred`). */
  private pred = 0;
  /** Property 15 (max-magnitude neighbouring true error) from the last `predict` call. */
  maxError = 0;

  constructor(hdr: WpHeader, width: number) {
    this.hdr = hdr;
    this.width = width;
    const n = (width + 2) * 2;
    this.predErr = [new Uint32Array(n), new Uint32Array(n), new Uint32Array(n), new Uint32Array(n)];
    this.error = new Int32Array(n);
  }

  /** Returns the rounded prediction; N/W/NE/NW/NN are the edge-resolved neighbours. */
  predict(x: number, y: number, N: number, W: number, NE: number, NW: number, NN: number): number {
    const xs = this.width;
    const prevRow = y & 1 ? xs + 2 : 0;
    const curRow = y & 1 ? 0 : xs + 2;
    const posN = prevRow + x;
    const posNE = x < xs - 1 ? posN + 1 : posN;
    const posNW = x > 0 ? posN - 1 : posN;
    const hdr = this.hdr;
    const weights = this.weights;
    for (let i = 0; i < 4; i++) {
      const pe = this.predErr[i]!;
      const e = (pe[posN]! + pe[posNE]! + pe[posNW]!) >>> 0;
      let shift = floorLog2(e + 1) - 5;
      if (shift < 0) shift = 0;
      weights[i] = 4 + ((hdr.w[i]! * DIV_LOOKUP[e >>> shift]!) >>> shift);
    }

    const N3 = N * 8;
    const W3 = W * 8;
    const NE3 = NE * 8;
    const NW3 = NW * 8;
    const NN3 = NN * 8;
    const err = this.error;
    const teW = x === 0 ? 0 : err[curRow + x - 1]!;
    const teN = err[posN]!;
    const teNW = err[posNW]!;
    const teNE = err[posNE]!;
    const sumWN = teN + teW;

    let p = teW;
    if (Math.abs(teN) > Math.abs(p)) p = teN;
    if (Math.abs(teNW) > Math.abs(p)) p = teNW;
    if (Math.abs(teNE) > Math.abs(p)) p = teNE;
    this.maxError = p;

    const pr = this.prediction;
    pr[0] = W3 + NE3 - N3;
    pr[1] = N3 - Math.floor(((sumWN + teNE) * hdr.p1C) / 32);
    pr[2] = W3 - Math.floor(((sumWN + teNW) * hdr.p2C) / 32);
    pr[3] =
      N3 -
      Math.floor(
        (teNW * hdr.p3Ca + teN * hdr.p3Cb + teNE * hdr.p3Cc + (NN3 - N3) * hdr.p3Cd + (NW3 - W3) * hdr.p3Ce) / 32,
      );

    // WeightedAverage
    const logWeight = floorLog2(weights[0]! + weights[1]! + weights[2]! + weights[3]!) - 4;
    const w0 = weights[0]! >>> logWeight;
    const w1 = weights[1]! >>> logWeight;
    const w2 = weights[2]! >>> logWeight;
    const w3 = weights[3]! >>> logWeight;
    const wsum = w0 + w1 + w2 + w3;
    const sum = (wsum >>> 1) - 1 + pr[0] * w0 + pr[1] * w1 + pr[2] * w2 + pr[3] * w3;
    let pred = mulShift24(sum, DIV_LOOKUP[wsum - 1]!);

    if (((teN ^ teW) | (teN ^ teNW)) <= 0) {
      const mx = Math.max(W3, NE3, N3);
      const mn = Math.min(W3, NE3, N3);
      if (pred < mn) pred = mn;
      else if (pred > mx) pred = mx;
    }
    this.pred = pred;
    return Math.floor((pred + 3) / 8);
  }

  /** Record the decoded sample at (x, y) (libjxl UpdateErrors). */
  update(val: number, x: number, y: number): void {
    const xs = this.width;
    const prevRow = y & 1 ? xs + 2 : 0;
    const curRow = y & 1 ? 0 : xs + 2;
    const v3 = val * 8;
    this.error[curRow + x] = this.pred - v3;
    const pr = this.prediction;
    for (let i = 0; i < 4; i++) {
      const e = Math.floor((Math.abs(pr[i]! - v3) + 3) / 8);
      const pe = this.predErr[i]!;
      pe[curRow + x] = e;
      pe[prevRow + x + 1] = pe[prevRow + x + 1]! + e;
    }
  }
}

/**
 * Predict sample (x, y) of a channel with a fixed predictor (no MA tree). Used by the delta
 * palette (libjxl PredictNoTreeNoWP / PredictNoTreeWP). Caller must call `wp.update` afterwards.
 */
export function predictNoTree(
  data: Int32Array,
  w: number,
  x: number,
  y: number,
  predictor: number,
  wp: WpState | null,
): number {
  const i = y * w + x;
  const left = x > 0 ? data[i - 1]! : y > 0 ? data[i - w]! : 0;
  const top = y > 0 ? data[i - w]! : left;
  const topleft = x > 0 && y > 0 ? data[i - w - 1]! : left;
  const topright = x + 1 < w && y > 0 ? data[i - w + 1]! : top;
  const leftleft = x > 1 ? data[i - 2]! : left;
  const toptop = y > 1 ? data[i - 2 * w]! : top;
  const trr = x + 2 < w && y > 0 ? data[i - w + 2]! : topright;
  const wpPred = wp ? wp.predict(x, y, top, left, topright, topleft, toptop) : 0;
  return predictOne(predictor, left, top, toptop, topleft, topright, leftleft, trr, wpPred);
}
