import { describe, expect, it } from 'vitest';
import {
  expandUpsampleKernels,
  JXL_DEFAULT_UP2_WEIGHTS,
  JXL_DEFAULT_UP4_WEIGHTS,
  JXL_DEFAULT_UP8_WEIGHTS,
  upsamplePlane,
} from './jxlUpsample.js';

const KS = [2, 4, 8] as const;

describe('jxlUpsample', () => {
  it('default kernels are normalized and constants are preserved', () => {
    for (const [k, w] of [
      [2, JXL_DEFAULT_UP2_WEIGHTS],
      [4, JXL_DEFAULT_UP4_WEIGHTS],
      [8, JXL_DEFAULT_UP8_WEIGHTS],
    ] as const) {
      const kernels = expandUpsampleKernels(k, w);
      expect(kernels.length).toBe((k / 2) ** 2 * 25);
      for (let i = 0; i < kernels.length; i += 25) {
        expect(kernels.subarray(i, i + 25).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 2);
      }
      const out = upsamplePlane(new Float32Array(3 * 2).fill(0.7), 3, 2, k);
      expect(out.length).toBe(3 * 2 * k * k);
      for (const v of out) expect(v).toBeCloseTo(0.7, 6);
    }
  });

  it('is symmetric and bounded for an impulse', () => {
    for (const k of KS) {
      const n = 5;
      const src = new Float32Array(n * n);
      src[12] = 1;
      const out = upsamplePlane(src, n, n, k);
      const ow = n * k;
      for (let y = 0; y < ow; y++) {
        for (let x = 0; x < ow; x++) {
          const v = out[y * ow + x];
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
          expect(out[y * ow + (ow - 1 - x)]).toBeCloseTo(v, 6);
          expect(out[(ow - 1 - y) * ow + x]).toBeCloseTo(v, 6);
          expect(out[x * ow + y]).toBeCloseTo(v, 6);
        }
      }
      // The centre cell is brightest around the impulse.
      const c = 2 * k + (k >> 1);
      expect(out[c * ow + c]).toBeGreaterThan(0.3);
    }
  });

  it('reproduces a 2x kernel weight directly (first weight at kernel (0,0) of cell (0,0))', () => {
    const w = Array.from({ length: 15 }, (_, i) => (i === 0 ? 1 : 0));
    // Only kernel tap (0,0) of the top-left sub-pixel is non-zero: output(0,0) = in(-2,-2) mirrored = in(1,1).
    const src = Float32Array.from({ length: 9 }, (_, i) => i / 8);
    const out = upsamplePlane(src, 3, 3, 2, w);
    expect(out[0]).toBeCloseTo(src[4], 6);
    // Bottom-right sub-pixel uses the flipped kernel -> tap (4,4) -> in(+2,+2) mirrored.
    expect(out[1 * 6 + 1]).toBeCloseTo(src[mirror(2, 3) * 3 + mirror(2, 3)], 6);
  });
});

function mirror(i: number, n: number): number {
  return i >= n ? 2 * n - 1 - i : i < 0 ? -i - 1 : i;
}
