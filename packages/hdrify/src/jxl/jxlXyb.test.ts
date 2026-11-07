import { describe, expect, it } from 'vitest';
import { JXL_OPSIN_ABSORBANCE_MATRIX, linearToSrgb, srgbToLinear, xybToLinearSrgb, ycbcrToRgb } from './jxlXyb.js';

const BIAS = 0.0037930732552754493;

const enc = (v: number) => Math.cbrt(v) - Math.cbrt(BIAS);

/** libjxl enc_xyb.cc LinearRGBToXYB (forward opsin), float64. */
function linearToXyb(r: number, g: number, b: number): [number, number, number] {
  const m = JXL_OPSIN_ABSORBANCE_MATRIX;
  const mix = [0, 1, 2].map((i) => m[i * 3] * r + m[i * 3 + 1] * g + m[i * 3 + 2] * b + BIAS);
  const l = enc(mix[0]);
  const mm = enc(mix[1]);
  const s = enc(mix[2]);
  return [(l - mm) / 2, (l + mm) / 2, s];
}

describe('jxlXyb', () => {
  it('maps linear white to X=0, Y=B=cbrt(1+bias)-cbrt(bias)', () => {
    const [x, y, b] = linearToXyb(1, 1, 1);
    expect(x).toBeCloseTo(0, 6);
    const yWhite = Math.cbrt(1 + BIAS) - Math.cbrt(BIAS);
    expect(y).toBeCloseTo(yWhite, 6);
    expect(b).toBeCloseTo(yWhite, 6);
    expect(yWhite).toBeCloseTo(0.8453, 3);
  });

  it('round-trips forward opsin through the default inverse', () => {
    const colors = [
      [1, 1, 1],
      [0.18, 0.18, 0.18],
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.3, 0.6, 0.1],
      [4, 2, 0.5],
    ] as const;
    const n = colors.length;
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const bs = new Float32Array(n);
    colors.forEach(([r, g, b], i) => {
      [xs[i], ys[i], bs[i]] = linearToXyb(r, g, b);
    });
    xybToLinearSrgb(xs, ys, bs, n);
    colors.forEach(([r, g, b], i) => {
      expect(xs[i]).toBeCloseTo(r, 4);
      expect(ys[i]).toBeCloseTo(g, 4);
      expect(bs[i]).toBeCloseTo(b, 4);
    });
  });

  it('scales by 255 / intensity_target', () => {
    const [x, y, b] = linearToXyb(1, 1, 1);
    const p = [Float32Array.of(x), Float32Array.of(y), Float32Array.of(b)] as const;
    xybToLinearSrgb(p[0], p[1], p[2], 1, { intensityTarget: 1000 });
    for (const c of p) expect(c[0]).toBeCloseTo(0.255, 4);
  });

  it('converts YCbCr (Cb, Y, Cr planes) to RGB', () => {
    const cb = Float32Array.of(0, 0.1);
    const y = Float32Array.of(0.5 - 128 / 255, 0.5 - 128 / 255);
    const cr = Float32Array.of(0, -0.2);
    ycbcrToRgb(cb, y, cr, 2);
    expect([cb[0], y[0], cr[0]].map((v) => +v.toFixed(6))).toEqual([0.5, 0.5, 0.5]);
    expect(cb[1]).toBeCloseTo(0.5 - 0.2 * 1.402, 6);
    expect(cr[1]).toBeCloseTo(0.5 + 0.1 * 1.772, 6);
    // Luma is preserved: 0.299 R + 0.587 G + 0.114 B = Y.
    expect(0.299 * cb[1] + 0.587 * y[1] + 0.114 * cr[1]).toBeCloseTo(0.5, 6);
  });

  it('sRGB transfer helpers invert each other', () => {
    for (const v of [-0.5, 0, 0.002, 0.04, 0.5, 1, 2]) expect(srgbToLinear(linearToSrgb(v))).toBeCloseTo(v, 9);
    expect(linearToSrgb(0.18)).toBeCloseTo(0.4613561, 6);
  });
});
