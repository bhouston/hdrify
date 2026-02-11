import { describe, expect, it } from 'vitest';
import { encodeToJpeg } from './jpegEncoder.js';

describe('encodeToJpeg', () => {
  it('should encode RGBA data to JPEG CompressedImage', () => {
    const data = new Uint8ClampedArray(4 * 2 * 2); // 2x2 RGBA
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128;
      data[i + 1] = 64;
      data[i + 2] = 192;
      data[i + 3] = 255;
    }
    const result = encodeToJpeg(data, 2, 2, 90);

    expect(result).toBeDefined();
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.data[0]).toBe(0xff);
    expect(result.data[1]).toBe(0xd8);
  });

  it('should accept Uint8Array as input', () => {
    const data = new Uint8Array(4 * 1 * 1);
    data[0] = 255;
    data[1] = 0;
    data[2] = 0;
    data[3] = 255;
    const result = encodeToJpeg(data as unknown as Uint8ClampedArray, 1, 1);

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('should respect quality parameter', () => {
    const data = new Uint8ClampedArray(4 * 10 * 10);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (i % 256);
      data[i + 1] = ((i * 7) % 256);
      data[i + 2] = ((i * 13) % 256);
      data[i + 3] = 255;
    }
    const highQuality = encodeToJpeg(data, 10, 10, 95);
    const lowQuality = encodeToJpeg(data, 10, 10, 10);

    expect(highQuality.data.length).toBeGreaterThanOrEqual(lowQuality.data.length);
  });
});
