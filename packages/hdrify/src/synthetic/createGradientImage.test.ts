import { describe, expect, it } from 'vitest';
import { createGradientImage } from './createGradientImage.js';

describe('createGradientImage', () => {
  it('creates image with correct dimensions', () => {
    const img = createGradientImage({ width: 64, height: 32, mode: 'horizontal', min: 0, max: 1 });
    expect(img.width).toBe(64);
    expect(img.height).toBe(32);
    expect(img.data.length).toBe(64 * 32 * 4);
  });

  it('horizontal gradient: left edge at min, right edge at max', () => {
    const img = createGradientImage({ width: 101, height: 1, mode: 'horizontal', min: 0, max: 1 });
    const left = img.data[0] ?? 0;
    const right = img.data[100 * 4] ?? 0; // pixel 100 (rightmost), rgba
    expect(left).toBeCloseTo(0);
    expect(right).toBeCloseTo(1, 5);
  });

  it('vertical gradient: top at min, bottom at max', () => {
    const img = createGradientImage({ width: 1, height: 101, mode: 'vertical', min: 0, max: 1 });
    const top = img.data[0] ?? 0;
    const bottom = img.data[100 * 4] ?? 0;
    expect(top).toBeCloseTo(0);
    expect(bottom).toBeCloseTo(1);
  });

  it('supports zero-crossing gradient', () => {
    const img = createGradientImage({
      width: 11,
      height: 1,
      mode: 'horizontal',
      min: -0.1,
      max: 0.1,
    });
    const left = img.data[0] ?? 0;
    const right = img.data[40] ?? 0;
    expect(left).toBeCloseTo(-0.1);
    expect(right).toBeCloseTo(0.1);
  });

  it('channel rgb produces gray ramp', () => {
    const img = createGradientImage({
      width: 2,
      height: 1,
      mode: 'horizontal',
      min: 0.25,
      max: 0.75,
      channel: 'rgb',
    });
    expect(img.data[0]).toBeCloseTo(img.data[1] ?? 0);
    expect(img.data[1]).toBeCloseTo(img.data[2] ?? 0);
  });

  it('alpha is 1.0 everywhere', () => {
    const img = createGradientImage({ width: 4, height: 4, mode: 'horizontal', min: 0, max: 1 });
    for (let i = 3; i < img.data.length; i += 4) {
      expect(img.data[i] ?? 0).toBe(1);
    }
  });
});
