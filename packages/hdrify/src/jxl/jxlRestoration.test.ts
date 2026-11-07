import { describe, expect, it } from 'vitest';
import {
  applyEpf,
  applyGaborish,
  epfSigma,
  JXL_DEFAULT_EPF_PARAMS,
  JXL_DEFAULT_GABORISH_WEIGHTS,
  mirrorCoord,
} from './jxlRestoration.js';

const [W1, W2] = JXL_DEFAULT_GABORISH_WEIGHTS[0];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('jxlRestoration: mirror', () => {
  it('reflects coordinates like the spec Mirror()', () => {
    expect([-3, -2, -1, 0, 4, 5, 6, 7].map((i) => mirrorCoord(i, 5))).toEqual([2, 1, 0, 0, 4, 4, 3, 2]);
    expect(mirrorCoord(-1, 1)).toBe(0);
    expect(mirrorCoord(3, 1)).toBe(0);
  });
});

describe('jxlRestoration: gaborish', () => {
  it('leaves a constant image unchanged', () => {
    const p = new Float32Array(7 * 5).fill(0.4);
    applyGaborish(p, 7, 5, W1, W2);
    for (const v of p) expect(v).toBeCloseTo(0.4, 6);
    const one = Float32Array.of(2);
    applyGaborish(one, 1, 1, W1, W2);
    expect(one[0]).toBeCloseTo(2, 6);
  });

  it('has the libjxl 3x3 impulse response', () => {
    const w = 5;
    const p = new Float32Array(25);
    p[12] = 1;
    applyGaborish(p, w, 5, W1, W2);
    const norm = 1 + 4 * W1 + 4 * W2;
    expect(p[12]).toBeCloseTo(1 / norm, 6);
    for (const i of [7, 11, 13, 17]) expect(p[i]).toBeCloseTo(W1 / norm, 6);
    for (const i of [6, 8, 16, 18]) expect(p[i]).toBeCloseTo(W2 / norm, 6);
    expect(p[0]).toBe(0);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('mirrors at the border', () => {
    const p = new Float32Array(9);
    p[0] = 1; // corner: mirrored copies at (-1,-1), (-1,0), (0,-1)
    applyGaborish(p, 3, 3, W1, W2);
    const norm = 1 + 4 * W1 + 4 * W2;
    expect(p[0]).toBeCloseTo((1 + 2 * W1 + W2) / norm, 6);
    expect(p[1]).toBeCloseTo((W1 + W2) / norm, 6);
  });
});

describe('jxlRestoration: EPF', () => {
  const w = 16;
  const h = 16;
  const sigmaStride = 2;

  it('leaves constant images unchanged for every iteration count', () => {
    for (const iters of [1, 2, 3]) {
      const planes = [0.1, 0.5, -0.2].map((v) => new Float32Array(w * h).fill(v));
      applyEpf(planes, w, h, new Float32Array(4).fill(2), sigmaStride, { ...JXL_DEFAULT_EPF_PARAMS, iters });
      planes.forEach((p, c) => {
        for (const v of p) expect(v).toBeCloseTo([0.1, 0.5, -0.2][c], 6);
      });
    }
  });

  it('skips blocks with sigma < 0.3 and smooths noise elsewhere', () => {
    const r = rng(5);
    const planes = [0, 1, 2].map(() => Float32Array.from({ length: w * h }, () => 0.5 + (r() - 0.5) * 0.002));
    const orig = planes.map((p) => p.slice());
    const sigma = Float32Array.of(0.1, 5, 5, 5); // block (0,0) disabled
    applyEpf(planes, w, h, sigma, sigmaStride);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(planes[1][y * w + x]).toBe(orig[1][y * w + x]);
    const variance = (p: Float32Array) => {
      let s = 0;
      for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) s += (p[y * w + x] - 0.5) ** 2;
      return s;
    };
    expect(variance(planes[1])).toBeLessThan(variance(orig[1]) * 0.5);
  });

  it('preserves strong edges', () => {
    const planes = [0, 1, 2].map(() => Float32Array.from({ length: w * h }, (_, i) => (i % w < 8 ? 0 : 1)));
    applyEpf(planes, w, h, new Float32Array(4).fill(1), sigmaStride, { ...JXL_DEFAULT_EPF_PARAMS, iters: 3 });
    for (let y = 0; y < h; y++) {
      expect(planes[0][y * w + 7]).toBeCloseTo(0, 4);
      expect(planes[0][y * w + 8]).toBeCloseTo(1, 4);
    }
  });

  it('is symmetric under horizontal flip (width multiple of 8)', () => {
    const r = rng(9);
    const base = [0, 1, 2].map(() => Float32Array.from({ length: w * h }, () => r() * 0.01));
    const flip = (p: Float32Array) => Float32Array.from(p, (_, i) => p[Math.floor(i / w) * w + (w - 1 - (i % w))]);
    const a = base.map((p) => p.slice());
    const b = base.map(flip);
    const sigma = new Float32Array(4).fill(3);
    applyEpf(a, w, h, sigma, sigmaStride, { ...JXL_DEFAULT_EPF_PARAMS, iters: 3 });
    applyEpf(b, w, h, sigma, sigmaStride, { ...JXL_DEFAULT_EPF_PARAMS, iters: 3 });
    const bf = b.map(flip);
    for (let c = 0; c < 3; c++) for (let i = 0; i < w * h; i++) expect(bf[c][i]).toBeCloseTo(a[c][i], 6);
  });

  it('computes sigma from quant field and sharpness', () => {
    expect(epfSigma(65536, 1, 7)).toBeCloseTo(0.46, 6);
    expect(epfSigma(32768, 4, 0)).toBe(0);
    expect(epfSigma(65536, 2, 7, 1, [0, 0, 0, 0, 0, 0, 0, 1])).toBeCloseTo(0.5, 6);
  });
});
