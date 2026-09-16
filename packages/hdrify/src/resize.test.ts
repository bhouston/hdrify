import { describe, expect, it } from 'vitest';
import { createGradientImage } from './synthetic/createGradientImage.js';
import { RESIZE_FILTERS, resizeImage } from './resize.js';

describe('resizeImage', () => {
  it('resizes to requested dimensions for every filter', () => {
    const img = createGradientImage({ width: 16, height: 8, mode: 'horizontal', min: 0, max: 1 });
    for (const filter of RESIZE_FILTERS) {
      const resized = resizeImage(img, { width: 32, height: 4, filter });
      expect(resized.width).toBe(32);
      expect(resized.height).toBe(4);
      expect(resized.data.length).toBe(32 * 4 * 4);
    }
  });

  it('nearest picks exact source values, no blending', () => {
    const img = createGradientImage({ width: 4, height: 1, mode: 'horizontal', min: 0, max: 3 });
    const resized = resizeImage(img, { width: 8, height: 1, filter: 'nearest' });
    const values = new Set<number>();
    for (let x = 0; x < 8; x++) values.add(Math.round(resized.data[x * 4]!));
    for (const v of values) expect([0, 1, 2, 3]).toContain(v);
  });

  it('preserves a flat image (no ringing/overshoot) for bilinear and lanczos', () => {
    const img = createGradientImage({ width: 10, height: 10, mode: 'horizontal', min: 5, max: 5 });
    for (const filter of ['bilinear', 'lanczos'] as const) {
      const resized = resizeImage(img, { width: 7, height: 13, filter });
      for (let i = 0; i < resized.data.length; i += 4) {
        expect(resized.data[i]).toBeCloseTo(5, 4);
      }
    }
  });

  it('no-op resize returns a copy with same dimensions', () => {
    const img = createGradientImage({ width: 5, height: 5, mode: 'horizontal', min: 0, max: 1 });
    const resized = resizeImage(img, { width: 5, height: 5, filter: 'lanczos' });
    expect(resized.data).not.toBe(img.data);
    expect(Array.from(resized.data)).toEqual(Array.from(img.data));
  });

  it('rejects non-integer or non-positive dimensions', () => {
    const img = createGradientImage({ width: 4, height: 4, mode: 'horizontal', min: 0, max: 1 });
    expect(() => resizeImage(img, { width: 0, height: 4 })).toThrow();
    expect(() => resizeImage(img, { width: 4.5, height: 4 })).toThrow();
  });
});
