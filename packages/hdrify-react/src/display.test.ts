import { describe, expect, it } from 'vitest';
import { displayPixels } from './display.js';

describe('HDR display pixels', () => {
  it('preserves signed extended values and never changes the decoded image', () => {
    const data = new Float32Array([-0.25, 2, 4, 0.5]);
    const pixels = displayPixels({ width: 1, height: 1, data, linearColorSpace: 'linear-rec709' }, 'none', 2);
    expect(Array.from(pixels)).toEqual([-0.5, 4, 8, 1]);
    expect(Array.from(data)).toEqual([-0.25, 2, 4, 0.5]);
  });
  it('uses the selected linear tone mapper without an 8-bit intermediate', () => {
    const pixels = displayPixels(
      { width: 1, height: 1, data: new Float32Array([1, 2, 4, 1]), linearColorSpace: 'linear-rec709' },
      'reinhard',
    );
    expect(pixels[0]).toBeCloseTo(0.5);
    expect(pixels[1]).toBeCloseTo(2 / 3);
    expect(pixels[2]).toBeCloseTo(0.8);
  });
  it('converts P3 primaries while retaining out-of-gamut values', () => {
    const pixels = displayPixels(
      { width: 1, height: 1, data: new Float32Array([1, 0, 0, 1]), linearColorSpace: 'linear-p3' },
      'none',
    );
    expect(pixels[0]).toBeCloseTo(1.22494, 3);
    expect(pixels[1]).toBeCloseTo(-0.042057, 3);
    expect(pixels[2]).toBeCloseTo(-0.019638, 3);
  });
});
