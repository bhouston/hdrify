import { describe, expect, it } from 'vitest';
import { createCieColorWedgeImage } from './createCieColorWedgeImage.js';

describe('createCieColorWedgeImage', () => {
  it('creates image with correct dimensions (default 512x512)', () => {
    const img = createCieColorWedgeImage({ width: 512, height: 512 });
    expect(img.width).toBe(512);
    expect(img.height).toBe(512);
    expect(img.data.length).toBe(512 * 512 * 4);
  });

  it('supports custom dimensions', () => {
    const img = createCieColorWedgeImage({ width: 64, height: 32 });
    expect(img.width).toBe(64);
    expect(img.height).toBe(32);
    expect(img.data.length).toBe(64 * 32 * 4);
  });

  it('returns linearColorSpace linear-rec2020', () => {
    const img = createCieColorWedgeImage({ width: 8, height: 8 });
    expect(img.linearColorSpace).toBe('linear-rec2020');
  });

  it('white point region (approx x=0.31, y=0.33) has high R,G,B', () => {
    const img = createCieColorWedgeImage({ width: 101, height: 101 });
    const px = Math.round((0.3127 / 0.735) * 100);
    const py = Math.round((1 - 0.329 / 0.834) * 100);
    const idx = (py * 101 + px) * 4;
    const r = img.data[idx] ?? 0;
    const g = img.data[idx + 1] ?? 0;
    const b = img.data[idx + 2] ?? 0;
    expect(r).toBeGreaterThan(0.5);
    expect(g).toBeGreaterThan(0.5);
    expect(b).toBeGreaterThan(0.5);
  });

  it('alpha is 1.0 everywhere', () => {
    const img = createCieColorWedgeImage({ width: 4, height: 4 });
    for (let i = 3; i < img.data.length; i += 4) {
      expect(img.data[i] ?? 0).toBe(1);
    }
  });
});
