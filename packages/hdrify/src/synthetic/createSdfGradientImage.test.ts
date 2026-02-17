import { describe, expect, it } from 'vitest';
import { createSdfGradientImage } from './createSdfGradientImage.js';

describe('createSdfGradientImage', () => {
  it('creates image with correct dimensions (512x512 default)', () => {
    const img = createSdfGradientImage({ width: 512, height: 512 });
    expect(img.width).toBe(512);
    expect(img.height).toBe(512);
    expect(img.data.length).toBe(512 * 512 * 4);
  });

  it('supports custom dimensions', () => {
    const img = createSdfGradientImage({ width: 64, height: 32 });
    expect(img.width).toBe(64);
    expect(img.height).toBe(32);
    expect(img.data.length).toBe(64 * 32 * 4);
  });

  it('returns linearColorSpace linear-rec709', () => {
    const img = createSdfGradientImage({ width: 8, height: 8 });
    expect(img.linearColorSpace).toBe('linear-rec709');
  });

  it('top-left (0,0) is white', () => {
    const img = createSdfGradientImage({ width: 16, height: 16 });
    const idx = 0;
    expect(img.data[idx]).toBe(1);
    expect(img.data[idx + 1]).toBe(1);
    expect(img.data[idx + 2]).toBe(1);
    expect(img.data[idx + 3]).toBe(1);
  });

  it('bottom-right is black', () => {
    const w = 16;
    const h = 16;
    const img = createSdfGradientImage({ width: w, height: h });
    const idx = ((h - 1) * w + (w - 1)) * 4;
    expect(img.data[idx]).toBe(0);
    expect(img.data[idx + 1]).toBe(0);
    expect(img.data[idx + 2]).toBe(0);
    expect(img.data[idx + 3]).toBe(1);
  });

  it('alpha is 1.0 everywhere', () => {
    const img = createSdfGradientImage({ width: 4, height: 4 });
    for (let i = 3; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(1);
    }
  });
});
