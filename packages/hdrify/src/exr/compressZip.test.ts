import { describe, expect, it } from 'vitest';
import { compressZipBlock } from './compressZip.js';
import { decompressZip } from './decompressZip.js';

describe('compressZipBlock', () => {
  it('round-trips with decompressZip', () => {
    const interleaved = new Uint8Array(64);
    for (let i = 0; i < 32; i++) {
      interleaved[i * 2] = i & 0xff;
      interleaved[i * 2 + 1] = (i + 1) & 0xff;
    }
    const compressed = compressZipBlock(interleaved);
    const result = decompressZip(compressed);
    expect(result).toEqual(interleaved);
  });

  it('round-trips 128-byte block (1 scanline ZIPS size)', () => {
    const interleaved = new Uint8Array(128);
    for (let i = 0; i < 64; i++) {
      interleaved[i * 2] = i & 0xff;
      interleaved[i * 2 + 1] = (i >> 8) & 0xff;
    }
    const compressed = compressZipBlock(interleaved);
    const result = decompressZip(compressed);
    expect(result).toEqual(interleaved);
  });
});
