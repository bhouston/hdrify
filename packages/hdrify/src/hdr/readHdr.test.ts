import { describe, expect, it } from 'vitest';
import { readHdr } from './readHdr.js';

describe('readHdr', () => {
  it('should read flat/uncompressed HDR (1x1)', () => {
    const header = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n\n';
    const pixels = new Uint8Array([0, 0, 0, 128]);
    const buffer = new Uint8Array([...new TextEncoder().encode(header), ...pixels]);
    const result = readHdr(buffer);

    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.data.length).toBe(4);
    expect(result.data[3]).toBe(1);
  });

  it('should read flat HDR (4x4) with narrow scanline', () => {
    const header = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 4 +X 4\n\n';
    const pixels = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 64;
      pixels[i + 1] = 64;
      pixels[i + 2] = 64;
      pixels[i + 3] = 128;
    }
    const buffer = new Uint8Array([...new TextEncoder().encode(header), ...pixels]);
    const result = readHdr(buffer);

    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    expect(result.data.length).toBe(64);
  });

  it('should read old RLE format (2x2)', () => {
    const header = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n\n';
    const pixels = new Uint8Array([64, 64, 64, 128, 255, 255, 255, 15]);
    const buffer = new Uint8Array([...new TextEncoder().encode(header), ...pixels]);
    const result = readHdr(buffer);

    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.data.length).toBe(16);
  });

  it('should read standard RLE format (8x8)', () => {
    const header = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 8 +X 8\n\n';
    const headerBytes = new TextEncoder().encode(header);
    const rlePixelData: number[] = [];
    for (let y = 0; y < 8; y++) {
      rlePixelData.push(2, 2, 0, 8);
      for (let c = 0; c < 4; c++) {
        const val = c === 3 ? 128 : 64;
        rlePixelData.push(8, val, val, val, val, val, val, val, val);
      }
    }
    const buffer = new Uint8Array([...headerBytes, ...rlePixelData]);
    const result = readHdr(buffer);

    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    expect(result.data.length).toBe(256);
  });

  it('should apply physicalRadiance when output option is set', () => {
    const header = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\nGAMMA=1\nEXPOSURE=2\n\n-Y 1 +X 1\n\n';
    const pixels = new Uint8Array([128, 128, 128, 129]);
    const buffer = new Uint8Array([...new TextEncoder().encode(header), ...pixels]);
    const raw = readHdr(buffer, { output: 'raw' });
    const physical = readHdr(buffer, { output: 'physicalRadiance' });

    expect(raw.metadata?.EXPOSURE).toBe(2);
    expect(physical.data[0]).toBeCloseTo((raw.data[0] ?? 0) * 0.5);
  });

  it('should throw when flat pixel data has wrong length', () => {
    const header = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n\n';
    const pixels = new Uint8Array([0, 0, 0, 128]);
    const buffer = new Uint8Array([...new TextEncoder().encode(header), ...pixels]);
    expect(() => readHdr(buffer)).toThrow(/expected \d+ bytes/);
  });

  it('should throw when buffer is empty', () => {
    expect(() => readHdr(new Uint8Array(0))).toThrow(/no header found/);
  });

  it('should throw when FORMAT is 32-bit_rle_xyze', () => {
    const badBuffer = new TextEncoder().encode(
      '#?RADIANCE\nFORMAT=32-bit_rle_xyze\n\n-Y 1 +X 1\n' +
        String.fromCharCode(2, 2, 0, 1) +
        String.fromCharCode(0, 0, 0, 128).repeat(4),
    );
    expect(() => readHdr(badBuffer)).toThrow(/XYZ format is not supported/);
  });

  it('should throw when resolution is unsupported', () => {
    const badBuffer = new TextEncoder().encode(
      '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n+Y 1 +X 1\n' +
        String.fromCharCode(2, 2, 0, 1) +
        String.fromCharCode(0, 0, 0, 128).repeat(4),
    );
    expect(() => readHdr(badBuffer)).toThrow(/Unsupported resolution format/);
  });

  it('should throw when wrong scanline width in RLE', () => {
    const header = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 8 +X 8\n\n';
    const headerBytes = new TextEncoder().encode(header);
    const rleHeader = new Uint8Array([2, 2, 0, 4]); // wrong: 4 instead of 8
    const buffer = new Uint8Array([...headerBytes, ...rleHeader, ...new Uint8Array(100)]);
    expect(() => readHdr(buffer)).toThrow(/wrong scanline width/);
  });
});
