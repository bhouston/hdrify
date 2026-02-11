import { describe, expect, it } from 'vitest';
import { HUF_ENCSIZE } from './exrConstants.js';
import { hufCompress, hufUncompress } from './pizHuffman.js';

describe('hufCompress / hufUncompress', () => {
  it('round-trips data with long zero runs in symbol table', () => {
    // Data with sparse indices (0-3 and 100-103) to trigger SHORT_ZEROCODE_RUN or LONG_ZEROCODE_RUN
    const raw = new Uint16Array(200);
    for (let i = 0; i < 200; i++) {
      raw[i] = i % 8 < 4 ? i % 4 : 100 + (i % 4);
    }
    const compressed = hufCompress(raw);
    const out = new Uint16Array(200);
    const view = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
    const offset = { value: 0 };
    hufUncompress(compressed, view, offset, compressed.length, out, 200);
    expect(out).toEqual(raw);
  });

  it('throws on invalid im (out of HUF_ENCSIZE bounds)', () => {
    const validCompressed = hufCompress(new Uint16Array([1, 2, 3]));
    const view = new DataView(validCompressed.buffer, validCompressed.byteOffset, validCompressed.byteLength);
    const modified = new Uint8Array(validCompressed.length + 32);
    modified.set(validCompressed);
    const mView = new DataView(modified.buffer, modified.byteOffset, modified.byteLength);
    mView.setUint32(0, HUF_ENCSIZE, true);
    const out = new Uint16Array(3);
    const offset = { value: 0 };
    expect(() => hufUncompress(modified, mView, offset, modified.length, out, 3)).toThrow(/HUF_ENCSIZE/);
  });

  it('throws on invalid nBits (beyond available data)', () => {
    const validCompressed = hufCompress(new Uint16Array([1, 2, 3]));
    const view = new DataView(validCompressed.buffer, validCompressed.byteOffset, validCompressed.byteLength);
    const modified = new Uint8Array(validCompressed.length);
    modified.set(validCompressed);
    const mView = new DataView(modified.buffer, modified.byteOffset, modified.byteLength);
    const tableLength = mView.getUint32(8, true);
    const dataStart = 20 + tableLength;
    const availableBits = (modified.length - dataStart) * 8;
    mView.setUint32(12, availableBits + 1000, true);
    const out = new Uint16Array(3);
    const offset = { value: 0 };
    expect(() => hufUncompress(modified, mView, offset, modified.length, out, 3)).toThrow(/hufUncompress/);
  });

  it('round-trips empty array', () => {
    const raw = new Uint16Array(0);
    const compressed = hufCompress(raw);
    expect(compressed.length).toBe(0);
  });

  it('round-trips single value', () => {
    const raw = new Uint16Array([42]);
    const compressed = hufCompress(raw);
    expect(compressed.length).toBeGreaterThan(0);
    const out = new Uint16Array(1);
    const view = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
    const offset = { value: 0 };
    hufUncompress(compressed, view, offset, compressed.length, out, 1);
    expect(out[0]).toBe(42);
  });

  it('round-trips small array', () => {
    const raw = new Uint16Array([1, 2, 3, 4, 5]);
    const compressed = hufCompress(raw);
    const out = new Uint16Array(5);
    const view = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
    const offset = { value: 0 };
    hufUncompress(compressed, view, offset, compressed.length, out, 5);
    expect(out).toEqual(raw);
  });

  it('round-trips repeated values', () => {
    const raw = new Uint16Array(100);
    for (let i = 0; i < 100; i++) raw[i] = 0x1234;
    const compressed = hufCompress(raw);
    expect(compressed.length).toBeLessThan(raw.length * 2);
    const out = new Uint16Array(100);
    const view = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
    const offset = { value: 0 };
    hufUncompress(compressed, view, offset, compressed.length, out, 100);
    expect(out).toEqual(raw);
  });

  it('round-trips half-float-like data', () => {
    const raw = new Uint16Array(64);
    for (let i = 0; i < 64; i++) {
      raw[i] = ((i * 123) & 0xffff) | 0x3c00;
    }
    const compressed = hufCompress(raw);
    const out = new Uint16Array(64);
    const view = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
    const offset = { value: 0 };
    hufUncompress(compressed, view, offset, compressed.length, out, 64);
    expect(out).toEqual(raw);
  });
});
