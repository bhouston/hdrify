import { describe, expect, it } from 'vitest';
import { applyExrPredictor, reorderExrPixels } from './exrDsp.js';

describe('applyExrPredictor', () => {
  it('is a no-op for empty or single-byte input', () => {
    const empty = new Uint8Array([]);
    applyExrPredictor(empty);
    expect(empty).toEqual(new Uint8Array([]));

    const single = new Uint8Array([0x42]);
    applyExrPredictor(single);
    expect(single).toEqual(new Uint8Array([0x42]));
  });

  it('modifies buffer in place for even length', () => {
    const buf = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    applyExrPredictor(buf);
    // FFmpeg: init buf[1]+=buf[0]^0x80 => buf[1]=0x80. Loop (1,2): a=buf[1]+buf[2]=0x80,
    // buf[2]=0x80, buf[3]+=0x80, buf[2]^=0x80 => buf[2]=0. So buf[3]=0x80.
    expect(buf[1]).toBe(0x80);
    expect(buf[3]).toBe(0x80);
  });

  it('handles odd length buffers', () => {
    const buf = new Uint8Array([0x80, 0x00, 0x00]);
    applyExrPredictor(buf);
    // No initial block (odd size). Loop i=2: a = buf[1]+buf[2] = 0+0 = 0
    // buf[2]=0, buf[3] doesn't exist (odd size 3). buf[0] unchanged.
    expect(buf[0]).toBe(0x80);
    expect(buf[1]).toBe(0x00);
    expect(buf[2]).toBe(0x00);
  });
});

describe('reorderExrPixels', () => {
  it('interleaves first half with second half', () => {
    // Input: [0,1,2,3] -> first half [0,1], second half [2,3]
    // Output: [0,2,1,3] (low0,high0, low1,high1 for 16-bit values)
    const src = new Uint8Array([0, 1, 2, 3]);
    const dst = new Uint8Array(4);
    reorderExrPixels(dst, src);
    expect(dst).toEqual(new Uint8Array([0, 2, 1, 3]));
  });

  it('handles 2-byte pairs correctly', () => {
    const src = new Uint8Array([0xab, 0xcd, 0xef, 0x12]);
    const dst = new Uint8Array(4);
    reorderExrPixels(dst, src);
    expect(dst[0]).toBe(0xab);
    expect(dst[1]).toBe(0xef);
    expect(dst[2]).toBe(0xcd);
    expect(dst[3]).toBe(0x12);
  });

  it('produces same-length output as input', () => {
    const src = new Uint8Array(64);
    const dst = new Uint8Array(64);
    reorderExrPixels(dst, src);
    expect(dst.length).toBe(src.length);
  });
});
