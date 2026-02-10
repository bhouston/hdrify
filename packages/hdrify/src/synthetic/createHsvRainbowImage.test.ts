import { describe, expect, it } from 'vitest';
import { createHsvRainbowImage } from './createHsvRainbowImage.js';

describe('createHsvRainbowImage', () => {
  it('creates image with correct dimensions', () => {
    const img = createHsvRainbowImage({ width: 16, height: 8, value: 1, intensity: 1 });
    expect(img.width).toBe(16);
    expect(img.height).toBe(8);
  });

  it('creates data with correct length (RGBA)', () => {
    const img = createHsvRainbowImage({ width: 4, height: 4, value: 1, intensity: 1 });
    expect(img.data.length).toBe(4 * 4 * 4);
  });

  it('top-left pixel (hue≈0, sat=0) is grayscale at value × intensity', () => {
    const value = 0.8;
    const intensity = 2;
    const img = createHsvRainbowImage({ width: 16, height: 16, value, intensity });
    const r = img.data[0] ?? 0;
    const g = img.data[1] ?? 0;
    const b = img.data[2] ?? 0;
    const a = img.data[3] ?? 0;
    const expected = value * intensity;
    expect(r).toBeCloseTo(expected);
    expect(g).toBeCloseTo(expected);
    expect(b).toBeCloseTo(expected);
    expect(a).toBe(1.0);
  });

  it('bottom-left pixel (hue≈360, sat=0) is same grayscale as top-left', () => {
    const img = createHsvRainbowImage({ width: 16, height: 16, value: 1, intensity: 1 });
    const topLeft = img.data[0] ?? 0;
    const bottomLeftIndex = (15 * 16 + 0) * 4;
    const bottomLeft = img.data[bottomLeftIndex] ?? 0;
    expect(bottomLeft).toBeCloseTo(topLeft);
  });

  it('right edge (sat=1) has fully saturated colors', () => {
    const img = createHsvRainbowImage({ width: 16, height: 16, value: 1, intensity: 1 });
    // Top-right: hue=0, sat=1 -> red
    const topRightIndex = (0 * 16 + 15) * 4;
    expect(img.data[topRightIndex] ?? 0).toBeCloseTo(1);
    expect(img.data[topRightIndex + 1] ?? 0).toBeCloseTo(0);
    expect(img.data[topRightIndex + 2] ?? 0).toBeCloseTo(0);
  });

  it('alpha channel is 1.0 everywhere', () => {
    const img = createHsvRainbowImage({ width: 8, height: 8, value: 1, intensity: 1 });
    for (let i = 3; i < img.data.length; i += 4) {
      expect(img.data[i] ?? 0).toBe(1.0);
    }
  });

  it('applies intensity multiplier correctly', () => {
    const img = createHsvRainbowImage({ width: 4, height: 4, value: 0.5, intensity: 4 });
    const expected = 0.5 * 4;
    expect(img.data[0] ?? 0).toBeCloseTo(expected);
  });

  it('handles single pixel image', () => {
    const img = createHsvRainbowImage({ width: 1, height: 1, value: 1, intensity: 1 });
    expect(img.width).toBe(1);
    expect(img.height).toBe(1);
    expect(img.data.length).toBe(4);
    // hue=0, sat=0 -> grayscale
    expect(img.data[0] ?? 0).toBe(1);
    expect(img.data[1] ?? 0).toBe(1);
    expect(img.data[2] ?? 0).toBe(1);
    expect(img.data[3] ?? 0).toBe(1);
  });
});
