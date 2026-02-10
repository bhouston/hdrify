import { describe, expect, it } from 'vitest';
import { compareFloatImages } from './compareFloatImages.js';

function makeImage(width: number, height: number, fill: (i: number) => number): { width: number; height: number; data: Float32Array } {
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    data[i] = fill(i);
  }
  return { width, height, data };
}

describe('compareFloatImages', () => {
  it('identical images match', () => {
    const img = makeImage(4, 4, () => 0.5);
    const result = compareFloatImages(img, img);
    expect(result.match).toBe(true);
    expect(result.mismatchedPixels).toBe(0);
  });

  it('images within 1% match', () => {
    const a = makeImage(4, 4, () => 1.0);
    const b = makeImage(4, 4, (i) => (i % 4 === 3 ? 1.0 : 1.005)); // 0.5% diff
    const result = compareFloatImages(a, b, { tolerancePercent: 0.01 });
    expect(result.match).toBe(true);
  });

  it('images outside tolerance fail', () => {
    const a = makeImage(4, 4, () => 1.0);
    const b = makeImage(4, 4, (i) => (i % 4 === 3 ? 1.0 : 1.02)); // 2% diff
    const result = compareFloatImages(a, b, { tolerancePercent: 0.01 });
    expect(result.match).toBe(false);
    expect(result.mismatchedPixels).toBeGreaterThan(0);
  });

  it('dimension mismatch fails', () => {
    const a = makeImage(4, 4, () => 1.0);
    const b = makeImage(8, 4, () => 1.0);
    const result = compareFloatImages(a, b);
    expect(result.match).toBe(false);
  });

  it('near-zero values use absolute tolerance', () => {
    const a = makeImage(2, 2, () => 0.001);
    const b = makeImage(2, 2, () => 0.0011); // 10% relative diff but small absolute
    const result = compareFloatImages(a, b, { tolerancePercent: 0.01, toleranceAbsolute: 0.0002 });
    expect(result.match).toBe(true);
  });

  it('near-zero values fail when absolute diff exceeds tolerance', () => {
    const a = makeImage(2, 2, () => 0.001);
    const b = makeImage(2, 2, () => 0.005);
    const result = compareFloatImages(a, b, { toleranceAbsolute: 0.0002 });
    expect(result.match).toBe(false);
  });

  it('returns maxDiff and mismatchedPixels for debugging', () => {
    const a = makeImage(2, 2, () => 1.0);
    const b = makeImage(2, 2, (i) => (i === 0 ? 1.5 : 1.0));
    const result = compareFloatImages(a, b, { tolerancePercent: 0.01 });
    expect(result.match).toBe(false);
    expect(result.maxDiff).toBe(0.5);
    expect(result.mismatchedPixels).toBeGreaterThan(0);
  });
});
