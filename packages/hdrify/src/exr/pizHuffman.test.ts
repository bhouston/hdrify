import { describe, expect, it } from 'vitest';
import { hufCompress, hufUncompress } from './pizHuffman.js';

describe('hufCompress / hufUncompress', () => {
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
