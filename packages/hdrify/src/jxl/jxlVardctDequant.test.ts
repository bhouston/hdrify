import { describe, expect, it } from 'vitest';
import {
  adaptiveLfSmoothing,
  computeDefaultDequantMatrices,
  computeDequantMatrix,
  dctQuantWeights,
  dequantizeHfBlock,
  dequantMatrixFor,
  hfDequantMultiplier,
  JXL_QUANT_TABLE_SIZES,
  lfDequantScale,
} from './jxlVardctDequant.js';
import { defaultOpsinInverseMatrix } from './jxlImageHeader.js';
import { JxlAcStrategy } from './jxlVardctTransforms.js';

describe('jxlVardctDequant: default matrices', () => {
  const set = computeDefaultDequantMatrices();

  it('computes all 17 tables with positive finite multipliers', () => {
    expect(set.matrices).toHaveLength(17);
    set.matrices.forEach((m, t) => {
      const [w, h] = JXL_QUANT_TABLE_SIZES[t];
      for (const ch of m) {
        expect(ch.length).toBe(w * h);
        for (const v of ch) expect(v > 0 && v <= 1).toBe(true);
      }
    });
  });

  it('DCT8 Y matches libjxl GetQuantWeights bands (560, x1, /1.3, /1.3, /1.3, /1.3)', () => {
    const y = set.matrices[0][1];
    expect(y[0]).toBeCloseTo(1 / 560, 9);
    // (7,7) is at distance sqrt2 -> ~last band.
    expect(1 / y[63]).toBeCloseTo(560 / 1.3 ** 4, 1);
    // (7,0): distance 1 -> scaled pos 5 / (1 + 1e-6/sqrt2) * (1/sqrt2) ... compute with libjxl formula.
    const bands = [560, 560, 560 / 1.3, 560 / 1.3 ** 2, 560 / 1.3 ** 3, 560 / 1.3 ** 4];
    const pos = (1 * 5) / (Math.SQRT2 + 1e-6);
    const idx = Math.floor(pos);
    const expected = bands[idx] * (bands[idx + 1] / bands[idx]) ** (pos - idx);
    expect(1 / y[7]).toBeCloseTo(expected, 3);
  });

  it('IDENTITY / DCT2 / DCT4X8 / AFV special entries follow libjxl layouts', () => {
    const id = set.matrices[1][0];
    expect(1 / id[1]).toBeCloseTo(3160, 3);
    expect(1 / id[8]).toBeCloseTo(3160, 3);
    expect(1 / id[9]).toBeCloseTo(3160, 3);
    expect(1 / id[63]).toBeCloseTo(280, 3);
    const d2 = set.matrices[2][0];
    expect([1, 9, 2, 16, 18, 4, 32, 36, 63].map((i) => Math.round(1 / d2[i]))).toEqual([
      3840, 2560, 1280, 1280, 640, 480, 480, 300, 300,
    ]);
    const d48 = set.matrices[9][0];
    // Rows y and y^1 share the 4x8 row y/2; params[0] = 1 divides (1,0).
    for (let x = 0; x < 8; x++) expect(d48[16 + x]).toBe(d48[24 + x]);
    expect(1 / d48[0]).toBeCloseTo(2198.0505560163806, 2);
    const afv = set.matrices[10][0];
    expect(1 / afv[8]).toBeCloseTo(3072, 3);
    expect(1 / afv[1]).toBeCloseTo(3072, 3);
    expect(1 / afv[16]).toBeCloseTo(256, 3);
    expect(1 / afv[2]).toBeCloseTo(256, 3);
    expect(1 / afv[18]).toBeCloseTo(256, 3);
    // AFV high freq bands for X are all 414 (params 6..8 = 0).
    expect(1 / afv[6]).toBeCloseTo(414, 3);
  });

  it('transposed lookups for tall strategies', () => {
    const wide = dequantMatrixFor(set, JxlAcStrategy.DCT8X16, 1); // 16 x 8
    const tall = dequantMatrixFor(set, JxlAcStrategy.DCT16X8, 1); // 8 x 16
    for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) expect(tall[x * 8 + y]).toBe(wide[y * 16 + x]);
    expect(dequantMatrixFor(set, JxlAcStrategy.DCT4X8, 0)).toBe(dequantMatrixFor(set, JxlAcStrategy.DCT8X4, 0));
  });

  it('rejects invalid bands and supports raw tables', () => {
    expect(() => computeDequantMatrix(0, { mode: 'dct', dctParams: [[0], [1], [1]] })).toThrow();
    const t = Int32Array.from({ length: 64 }, (_, i) => i + 1);
    const m = computeDequantMatrix(0, { mode: 'raw', denominator: 1 / 64, table: [t, t, t] });
    expect(m[0][5]).toBeCloseTo(6 / 64, 7);
    expect(dctQuantWeights([100], 8, 8).every((v) => v === 100)).toBe(true);
  });
});

describe('jxlVardctDequant: coefficient dequantization', () => {
  it('applies AdjustQuantBias and multipliers', () => {
    const quant = Int32Array.from([0, 1, -1, 2, -3, 10, 0, 0]);
    const out = new Float32Array(8);
    const matrix = new Float32Array(8).fill(0.5);
    const { quantBias, quantBiasNumerator: num } = defaultOpsinInverseMatrix();
    const bias = quantBias[1];
    dequantizeHfBlock(quant, out, 0, 8, 8, 1, matrix, 2, bias, num);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(bias, 6);
    expect(out[2]).toBeCloseTo(-bias, 6);
    expect(out[3]).toBeCloseTo(2 - num / 2, 6);
    expect(out[4]).toBeCloseTo(-3 + num / 3, 6);
    expect(hfDequantMultiplier(65536, 4, 1)).toBe(0.25);
    expect(hfDequantMultiplier(65536, 1, 0, 3)).toBeCloseTo(0.8, 7);
    expect(lfDequantScale(1 / 32, 65536 / 32, 64, 0)).toBeCloseTo(((512 / 32 / 65536) * 32) / 64, 9);
    expect(lfDequantScale(1, 1, 1, 2)).toBe(128);
  });
});

describe('jxlVardctDequant: adaptive LF smoothing', () => {
  it('keeps constant planes and smooths small bumps but not large edges', () => {
    const w = 5;
    const h = 5;
    const mk = (v: number) => new Float32Array(w * h).fill(v);
    const flat = [mk(0.1), mk(0.2), mk(0.3)];
    adaptiveLfSmoothing(flat, w, h, [1, 1, 1]);
    expect(Array.from(flat[1]).every((v) => Math.abs(v - 0.2) < 1e-6)).toBe(true);

    const bump = [mk(0), mk(0), mk(0)];
    bump[1][12] = 1;
    adaptiveLfSmoothing(bump, w, h, [100, 100, 100]); // tiny gap -> full smoothing
    expect(bump[1][12]).toBeCloseTo(0.052262735, 6);
    expect(bump[1][7]).toBeCloseTo(0.2034514, 6);

    const edge = [mk(0), mk(0), mk(0)];
    edge[1][12] = 1;
    adaptiveLfSmoothing(edge, w, h, [1e-3, 1e-3, 1e-3]); // huge gap -> untouched
    expect(edge[1][12]).toBe(1);
    expect(edge[1][7]).toBe(0);
  });
});
