import { describe, expect, it } from 'vitest';
import { applyExrPredictor, decompressRLE, reorderExrPixels } from './readExr.js';

describe('decompressRLE', () => {
  it('should decompress literal run: -1 followed by byte yields single byte', () => {
    // count=-1: copy 1 byte literally
    const compressed = new Uint8Array([0xff, 0xab]); // -1 as signed, 0xab
    const result = decompressRLE(compressed, 1);
    expect(result).toEqual(new Uint8Array([0xab]));
  });

  it('should decompress repeat run: 2 followed by byte yields 3 copies', () => {
    // count=2: repeat next byte 2+1=3 times
    const compressed = new Uint8Array([0x02, 0x42]);
    const result = decompressRLE(compressed, 3);
    expect(result).toEqual(new Uint8Array([0x42, 0x42, 0x42]));
  });

  it('should decompress mixed literal and repeat runs', () => {
    // -2 a b (literal 2 bytes) then 1 x (repeat 2 times)
    const compressed = new Uint8Array([0xfe, 0x01, 0x02, 0x01, 0xff]);
    const result = decompressRLE(compressed, 4);
    expect(result).toEqual(new Uint8Array([0x01, 0x02, 0xff, 0xff]));
  });

  it('should decompress run of 0 (repeat 1 time)', () => {
    const compressed = new Uint8Array([0x00, 0x77]);
    const result = decompressRLE(compressed, 1);
    expect(result).toEqual(new Uint8Array([0x77]));
  });

  it('should throw on truncated literal run', () => {
    const compressed = new Uint8Array([0xfe]); // -2: need 2 bytes, have 0
    expect(() => decompressRLE(compressed, 2)).toThrow('truncated literal run');
  });

  it('should throw on truncated repeat run', () => {
    const compressed = new Uint8Array([0x05]); // repeat: need value byte, have none
    expect(() => decompressRLE(compressed, 6)).toThrow('truncated repeat run');
  });

  it('should throw when output size mismatch', () => {
    const compressed = new Uint8Array([0x00, 0xaa]); // 1 byte output
    expect(() => decompressRLE(compressed, 2)).toThrow('wrong size');
  });
});

describe('RLE pipeline: decompressRLE + predictor + reorder', () => {
  it('pipeline produces expected size output', () => {
    const compressed = new Uint8Array([0xff, 0x00, 0x00, 0x00, 0x00]); // -1 + 4 bytes literal
    const raw = decompressRLE(compressed, 4);
    expect(raw.length).toBe(4);
    applyExrPredictor(raw);
    const reordered = new Uint8Array(raw.length);
    reorderExrPixels(reordered, raw);
    expect(reordered.length).toBe(4);
  });
});
