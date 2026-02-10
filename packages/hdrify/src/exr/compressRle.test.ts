import { describe, expect, it } from 'vitest';
import { compressRLE, compressRleBlock } from './compressRle.js';
import { decompressRLE, decompressRleBlock } from './decompressRle.js';

describe('compressRLE', () => {
  it('round-trips with decompressRLE', () => {
    const raw = new Uint8Array([0xab]);
    const compressed = compressRLE(raw);
    const result = decompressRLE(compressed, 1);
    expect(result).toEqual(raw);
  });

  it('compresses repeat run', () => {
    const raw = new Uint8Array([0x42, 0x42, 0x42]);
    const compressed = compressRLE(raw);
    expect(compressed.length).toBeLessThanOrEqual(3);
    const result = decompressRLE(compressed, 3);
    expect(result).toEqual(raw);
  });

  it('compresses literal run', () => {
    const raw = new Uint8Array([0x01, 0x02]);
    const compressed = compressRLE(raw);
    const result = decompressRLE(compressed, 2);
    expect(result).toEqual(raw);
  });

  it('compresses mixed literal and repeat', () => {
    const raw = new Uint8Array([0x01, 0x02, 0xff, 0xff]);
    const compressed = compressRLE(raw);
    const result = decompressRLE(compressed, 4);
    expect(result).toEqual(raw);
  });
});

describe('compressRleBlock', () => {
  it('round-trips with decompressRleBlock', () => {
    const interleaved = new Uint8Array([0x00, 0x3c, 0x00, 0x3c, 0x00, 0x3c, 0x00, 0x3c]);
    const compressed = compressRleBlock(interleaved);
    const result = decompressRleBlock(compressed, interleaved.length);
    expect(result).toEqual(interleaved);
  });
});
