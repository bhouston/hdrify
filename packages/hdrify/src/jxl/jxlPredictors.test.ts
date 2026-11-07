import { describe, expect, it } from 'vitest';
import {
  clampedGradient,
  defaultWpHeader,
  Predictor,
  predictNoTree,
  predictOne,
  type WpHeader,
  WpState,
} from './jxlPredictors.js';

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('predictOne', () => {
  // left=10, top=20, toptop=26, topleft=14, topright=30, leftleft=6, toprightright=40
  const n = [10, 20, 26, 14, 30, 6, 40] as const;
  const cases: [number, number][] = [
    [Predictor.Zero, 0],
    [Predictor.Left, 10],
    [Predictor.Top, 20],
    [Predictor.Average0, 15],
    // |top - topleft| = 6 < |left - topleft| = 4 is false -> top
    [Predictor.Select, 20],
    [Predictor.Gradient, 16],
    [Predictor.Weighted, 77],
    [Predictor.TopRight, 30],
    [Predictor.TopLeft, 14],
    [Predictor.LeftLeft, 6],
    [Predictor.Average1, 12],
    [Predictor.Average2, 17],
    [Predictor.Average3, 25],
    // (6*20 - 2*26 + 7*10 + 6 + 40 + 3*30 + 8) / 16 = 282 / 16 = 17
    [Predictor.Average4, 17],
  ];
  for (const [p, expected] of cases) {
    it(`predictor ${p}`, () => expect(predictOne(p, ...n, 77)).toBe(expected));
  }

  it('averages truncate toward zero like C', () => {
    expect(predictOne(Predictor.Average0, -3, 0, 0, 0, 0, 0, 0, 0)).toBe(-1);
    expect(predictOne(Predictor.Average1, -3, 0, 0, 0, 0, 0, 0, 0)).toBe(-1);
    expect(predictOne(Predictor.Average4, -1, 0, 0, 0, 0, 0, 0, 0) + 0).toBe(0); // (-7 + 8) / 16
    expect(predictOne(Predictor.Average4, -2, 0, 0, 0, 0, 0, 0, 0) + 0).toBe(0); // -6 / 16 -> 0, not -1
  });

  it('averages do not overflow on int32 extremes', () => {
    expect(predictOne(Predictor.Average0, 2 ** 31 - 1, 2 ** 31 - 1, 0, 0, 0, 0, 0, 0)).toBe(2 ** 31 - 1);
    expect(predictOne(Predictor.Average3, 0, -(2 ** 31), 0, 0, -(2 ** 31), 0, 0, 0)).toBe(-(2 ** 31));
  });

  it('select picks left when top is closer to topleft', () => {
    expect(predictOne(Predictor.Select, 10, 20, 0, 19, 0, 0, 0, 0)).toBe(10);
  });

  it('clamped gradient', () => {
    expect(clampedGradient(10, 20, 15)).toBe(15);
    expect(clampedGradient(10, 20, 5)).toBe(20); // below min -> max
    expect(clampedGradient(10, 20, 25)).toBe(10); // above max -> min
    expect(clampedGradient(20, 10, 25)).toBe(10);
  });

  it('rejects invalid predictor ids', () => {
    expect(() => predictOne(14, 0, 0, 0, 0, 0, 0, 0, 0)).toThrow();
  });
});

describe('predictNoTree edge rules (libjxl detail::Predict)', () => {
  // 4x3 grid, values = 10*y + x + 1:
  //  1  2  3  4
  // 11 12 13 14
  // 21 22 23 24
  const w = 4;
  const g = Int32Array.from({ length: 12 }, (_, i) => 10 * Math.floor(i / w) + (i % w) + 1);
  const at = (x: number, y: number, p: number) => predictNoTree(g, w, x, y, p, null);

  it('first pixel: everything is 0', () => {
    for (let p = 0; p < 14; p++) if (p !== Predictor.Weighted) expect(at(0, 0, p)).toBe(0);
  });
  it('first row: top/topleft/topright fall back to left', () => {
    expect(at(2, 0, Predictor.Left)).toBe(2);
    expect(at(2, 0, Predictor.Top)).toBe(2);
    expect(at(2, 0, Predictor.TopLeft)).toBe(2);
    expect(at(2, 0, Predictor.TopRight)).toBe(2);
    expect(at(2, 0, Predictor.LeftLeft)).toBe(1);
    expect(at(1, 0, Predictor.LeftLeft)).toBe(1); // x = 1: leftleft -> left
  });
  it('first column: left falls back to top; topleft to left', () => {
    expect(at(0, 1, Predictor.Left)).toBe(1);
    expect(at(0, 1, Predictor.Top)).toBe(1);
    expect(at(0, 1, Predictor.TopLeft)).toBe(1);
    expect(at(0, 1, Predictor.TopRight)).toBe(2);
    expect(at(0, 1, Predictor.LeftLeft)).toBe(1);
  });
  it('last column: topright falls back to top', () => {
    expect(at(3, 1, Predictor.TopRight)).toBe(4);
    expect(at(3, 2, Predictor.TopRight)).toBe(14);
  });
  it('toptop and toprightright fallbacks via Average4', () => {
    // (x=1,y=1): top=2, toptop->top=2, left=11, leftleft->left=11, topright=3, trr=4
    expect(at(1, 1, Predictor.Average4)).toBe(Math.trunc((6 * 2 - 2 * 2 + 7 * 11 + 11 + 4 + 3 * 3 + 8) / 16));
    // (x=2,y=2): top=13, toptop=3, left=22, leftleft=21, topright=14, trr->topright=14
    expect(at(2, 2, Predictor.Average4)).toBe(Math.trunc((6 * 13 - 2 * 3 + 7 * 22 + 21 + 14 + 3 * 14 + 8) / 16));
  });
  it('interior gradient', () => {
    expect(at(1, 1, Predictor.Gradient)).toBe(clampedGradient(11, 2, 1));
  });
});

const u32 = (v: bigint) => BigInt.asUintN(32, v);
const i32 = (v: bigint) => BigInt.asIntN(32, v);
const bdiv = (i: number) => BigInt(Math.floor(2 ** 24 / i));
/** libjxl divlookup[i] = 2^24 / (i + 1). */
const div = (i: number) => Math.floor(2 ** 24 / (i + 1));

/**
 * Independent BigInt port of jxl-oxide's SelfCorrectingPredictor (predictor.rs), which keeps
 * running error accumulators instead of libjxl's two-row ring buffer.
 */
class RefWp {
  private x = 0;
  private y = 0;
  private readonly trueErrRow: bigint[];
  private readonly subErrRow: bigint[][];
  private teW = 0n;
  private teNW = 0n;
  private teN = 0n;
  private teNE = 0n;
  private seNWWW = [0n, 0n, 0n, 0n];
  private seNW = [0n, 0n, 0n, 0n];
  private seNE = [0n, 0n, 0n, 0n];
  private last: { prediction: bigint; subpred: bigint[] } | null = null;
  maxError = 0n;

  constructor(
    private readonly wp: WpHeader,
    private readonly width: number,
  ) {
    this.trueErrRow = Array.from({ length: width }, () => 0n);
    this.subErrRow = Array.from({ length: width }, () => [0n, 0n, 0n, 0n]);
  }

  predict(n: number, nw: number, ne: number, w: number, nn: number): number {
    const wp = this.wp;
    const N3 = BigInt(n) << 3n;
    const NW3 = BigInt(nw) << 3n;
    const NE3 = BigInt(ne) << 3n;
    const W3 = BigInt(w) << 3n;
    const NN3 = BigInt(nn) << 3n;
    const { teW, teNW, teN, teNE } = this;
    const subpred = [
      W3 + NE3 - N3,
      N3 - (((teW + teN + teNE) * BigInt(wp.p1C)) >> 5n),
      W3 - (((teW + teN + teNW) * BigInt(wp.p2C)) >> 5n),
      N3 -
        ((teNW * BigInt(wp.p3Ca) +
          teN * BigInt(wp.p3Cb) +
          teNE * BigInt(wp.p3Cc) +
          (NN3 - N3) * BigInt(wp.p3Cd) +
          (NW3 - W3) * BigInt(wp.p3Ce)) >>
          5n),
    ];
    const weight: bigint[] = [];
    for (let i = 0; i < 4; i++) {
      const errSum = u32(this.seNWWW[i] + this.seNW[i] + this.seNE[i]);
      const v = (errSum + 1n) >> 5n;
      const shift = v === 0n ? 0n : BigInt(v.toString(2).length - 1);
      weight.push(4n + ((BigInt(wp.w[i]) * bdiv(Number(errSum >> shift) + 1)) >> shift));
    }
    let sum = weight.reduce((a, b) => a + b, 0n);
    const logWeight = BigInt((sum >> 4n).toString(2).length - 1);
    for (let i = 0; i < 4; i++) weight[i] = weight[i] >> logWeight;
    sum = weight.reduce((a, b) => a + b, 0n);
    let s = (sum >> 1n) - 1n;
    for (let i = 0; i < 4; i++) s += subpred[i] * weight[i];
    let prediction = (s * bdiv(Number(sum))) >> 24n;
    if (((teN ^ teW) | (teN ^ teNW)) <= 0n) {
      const mn = [N3, W3, NE3].reduce((a, b) => (a < b ? a : b));
      const mx = [N3, W3, NE3].reduce((a, b) => (a > b ? a : b));
      prediction = prediction < mn ? mn : prediction > mx ? mx : prediction;
    }
    let maxError = teW;
    for (const e of [teN, teNW, teNE]) if ((e < 0n ? -e : e) > (maxError < 0n ? -maxError : maxError)) maxError = e;
    this.maxError = maxError;
    this.last = { prediction, subpred };
    return Number((prediction + 3n) >> 3n);
  }

  record(sample: number): void {
    const { prediction, subpred } = this.last!;
    const s3 = BigInt(sample) << 3n;
    const trueErr = prediction - s3;
    const subErr = subpred.map((p) => u32(((p > s3 ? p - s3 : s3 - p) + 3n) >> 3n));
    this.trueErrRow[this.x] = i32(trueErr);
    this.subErrRow[this.x] = subErr;
    this.x++;
    if (this.x >= this.width) {
      this.y++;
      this.x = 0;
      this.teW = 0n;
      this.teN = this.trueErrRow[0]!;
      this.teNW = this.teN;
      this.seNW = [...this.subErrRow[0]];
      this.seNWWW = [...this.seNW];
      if (this.width <= 1) {
        this.teNE = this.teN;
        this.seNE = [...this.seNW];
      } else {
        this.teNE = this.trueErrRow[1]!;
        this.seNE = [...this.subErrRow[1]];
      }
    } else {
      this.teW = i32(trueErr);
      this.teNW = this.teN;
      this.teN = this.teNE;
      this.seNWWW = this.seNW;
      this.seNW = this.seNE.map((v, i) => u32(v + subErr[i]));
      if (this.x + 1 >= this.width) {
        this.teNE = this.teN;
        this.seNE = [...this.seNW];
      } else if (this.y !== 0) {
        this.teNE = this.trueErrRow[this.x + 1]!;
        this.seNE = [...this.subErrRow[this.x + 1]];
      }
    }
  }
}

function crossCheck(width: number, height: number, hdr: WpHeader, sample: () => number): void {
  const wp = new WpState(hdr, width);
  const ref = new RefWp(hdr, width);
  const img = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const left = x > 0 ? img[i - 1] : y > 0 ? img[i - width] : 0;
      const top = y > 0 ? img[i - width] : left;
      const topleft = x > 0 && y > 0 ? img[i - width - 1] : left;
      const topright = x + 1 < width && y > 0 ? img[i - width + 1] : top;
      const toptop = y > 1 ? img[i - 2 * width] : top;
      const a = wp.predict(x, y, top, left, topright, topleft, toptop);
      const b = ref.predict(top, topleft, topright, left, toptop);
      expect(a).toBe(b);
      expect(wp.maxError).toBe(Number(ref.maxError));
      // Mostly track the prediction (as a real image would) with occasional jumps.
      const v = sample();
      img[i] = Number.isNaN(v) ? a : v;
      wp.update(img[i], x, y);
      ref.record(img[i]);
    }
  }
}

describe('WpState', () => {
  it('first pixel of an all-zero history predicts 0 with max error 0', () => {
    const wp = new WpState(defaultWpHeader(), 4);
    expect(wp.predict(0, 0, 0, 0, 0, 0, 0)).toBe(0);
    expect(wp.maxError).toBe(0);
  });

  it('hand-computed second pixel', () => {
    // Pixel 0 = 100 with prediction 0: true error = 0 - 800 = -800; sub-errors |0 - 800| -> 100 each.
    const wp = new WpState(defaultWpHeader(), 4);
    wp.predict(0, 0, 0, 0, 0, 0, 0);
    wp.update(100, 0, 0);
    // Pixel (1, 0): N = W = NE = NW = NN = 100 (edge rules on the first row); teW = -800 is the max error.
    const p = wp.predict(1, 0, 100, 100, 100, 100, 100);
    expect(wp.maxError).toBe(-800);
    // Sub-predictions: [800, 800 - (-800*16>>5)=1200, 800 - (-800*10>>5)=1050, 800 - (0)=800].
    // Error sums: N slot got +100 from W, NE == N slot on... x < w-1 so NE is the untouched 0, NW = N:
    // err = 100 + 0 + 100 = 200 -> shift = floor(log2(201)) - 5 = 2; weight = 4 + (w*divlookup[50] >> 2).
    const wts = [13, 12, 12, 12].map((m) => 4 + ((m * div(200 >> 2)) >>> 2));
    const log = 31 - Math.clz32(wts.reduce((a, b) => a + b)) - 4;
    const ws = wts.map((v) => v >>> log);
    const wsum = ws.reduce((a, b) => a + b);
    const sum = (wsum >> 1) - 1 + 800 * ws[0] + 1200 * ws[1] + 1050 * ws[2] + 800 * ws[3];
    let pred = Math.floor((sum * div(wsum - 1)) / 2 ** 24);
    // teN ^ teW = 0 ^ -800 < 0 -> clamp to [800, 800].
    pred = Math.min(800, Math.max(800, pred));
    expect(p).toBe(Math.floor((pred + 3) / 8));
  });

  for (const width of [1, 2, 3, 17]) {
    it(`matches the jxl-oxide formulation, width ${width}, 8-bit`, () => {
      const r = rng(width);
      crossCheck(width, 9, defaultWpHeader(), () => Math.floor(r() * 256));
    });
  }

  it('matches with non-default parameters (libjxl PredictorMode 1)', () => {
    const r = rng(7);
    const hdr: WpHeader = { p1C: 8, p2C: 8, p3Ca: 4, p3Cb: 0, p3Cc: 3, p3Cd: 23, p3Ce: 2, w: [13, 12, 12, 11] };
    crossCheck(11, 11, hdr, () => Math.floor(r() * 65536) - 32768);
  });

  it('is exact for float32 bit patterns (int32 extremes)', () => {
    const r = rng(3);
    const hdr: WpHeader = { p1C: 31, p2C: 31, p3Ca: 31, p3Cb: 31, p3Cc: 31, p3Cd: 31, p3Ce: 31, w: [15, 15, 15, 15] };
    crossCheck(9, 9, hdr, () => (r() < 0.5 ? Math.floor(r() * 2 ** 32) | 0 : r() < 0.5 ? 2 ** 31 - 1 : -(2 ** 31)));
  });
});
