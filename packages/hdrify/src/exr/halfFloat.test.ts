import { describe, expect, it } from 'vitest';
import { decodeFloat16, encodeFloat16 } from './halfFloat.js';

describe('encodeFloat16', () => {
  it('round-trips with decodeFloat16 for common values', () => {
    const values = [0, 0.5, 1, 2, 0.25, 0.75, -1, -0.5];
    for (const v of values) {
      const half = encodeFloat16(v);
      const back = decodeFloat16(half);
      expect(back).toBeCloseTo(v, 3);
    }
  });

  it('handles zero', () => {
    expect(decodeFloat16(encodeFloat16(0))).toBe(0);
  });

  it('handles one', () => {
    expect(decodeFloat16(encodeFloat16(1))).toBe(1);
  });

  it('encodes NaN to half-precision NaN', () => {
    const half = encodeFloat16(NaN);
    expect(half & 0x7c00).toBe(0x7c00);
    expect(half & 0x03ff).not.toBe(0);
    expect(decodeFloat16(half)).toBeNaN();
  });

  it('encodes +Infinity to 0x7c00', () => {
    const half = encodeFloat16(Infinity);
    expect(half).toBe(0x7c00);
    expect(decodeFloat16(half)).toBe(Infinity);
  });

  it('encodes -Infinity to 0xfc00', () => {
    const half = encodeFloat16(-Infinity);
    expect(half).toBe(0xfc00);
    expect(decodeFloat16(half)).toBe(-Infinity);
  });

  it('encodes large overflow to infinity', () => {
    const half = encodeFloat16(1e20);
    expect(half).toBe(0x7c00);
    expect(decodeFloat16(half)).toBe(Infinity);
  });

  it('encodes very small denormalized numbers', () => {
    const small = 2 ** -20;
    const half = encodeFloat16(small);
    const back = decodeFloat16(half);
    expect(back).toBeCloseTo(small, 1);
  });
});

describe('decodeFloat16', () => {
  it('decodes 0x7c00 to +Infinity', () => {
    expect(decodeFloat16(0x7c00)).toBe(Infinity);
  });

  it('decodes 0xfc00 to -Infinity', () => {
    expect(decodeFloat16(0xfc00)).toBe(-Infinity);
  });

  it('decodes 0x7c01 (NaN) to NaN', () => {
    expect(decodeFloat16(0x7c01)).toBeNaN();
  });

  it('decodes 0x0001 (denormalized) to 2^-24', () => {
    expect(decodeFloat16(0x0001)).toBe(2 ** -24);
  });

  it('decodes -0 encoding', () => {
    const negZero = decodeFloat16(0x8000);
    expect(negZero).toBe(-0);
    expect(1 / negZero).toBe(-Infinity);
  });
});
