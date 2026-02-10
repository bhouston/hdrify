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
});
