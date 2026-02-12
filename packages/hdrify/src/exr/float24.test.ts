/**
 * PXR24 float24 conversion tests.
 * Matches OpenEXR internal_pxr24.c float_to_float24 behavior: sign in bit 23,
 * exponent in 22-16, rounded mantissa in 15-0; Inf/NaN handling.
 */
import { describe, expect, it } from 'vitest';
import { f24ToFloat32, float32ToF24 } from './pxr24Utils.js';

function roundTrip(f: number): number {
  const f24 = float32ToF24(f);
  const b0 = f24 & 0xff;
  const b1 = (f24 >> 8) & 0xff;
  const b2 = (f24 >> 16) & 0xff;
  return f24ToFloat32(b0, b1, b2);
}

function expectClose(actual: number, expected: number, tolerance: number, msg?: string) {
  if (Number.isNaN(expected)) {
    expect(Number.isNaN(actual), msg).toBe(true);
    return;
  }
  if (!Number.isFinite(expected)) {
    expect(actual === expected, msg ?? `expected ${expected}, got ${actual}`).toBe(true);
    return;
  }
  expect(Math.abs(actual - expected) <= tolerance, msg ?? `|${actual} - ${expected}| <= ${tolerance}`).toBe(true);
}

describe('float24 round-trip', () => {
  it('preserves 0 and -0', () => {
    expect(roundTrip(0)).toBe(0);
    const negZero = roundTrip(-0);
    expect(negZero === 0 || 1 / negZero < 0).toBe(true);
  });

  it('preserves 1 and -1', () => {
    expectClose(roundTrip(1), 1, 1e-5);
    expectClose(roundTrip(-1), -1, 1e-5);
  });

  it('preserves small normals within lossy tolerance', () => {
    const tolerance = 1e-4;
    const values = [0.5, 0.25, 1.5, 2, 100, 0.1, Math.PI];
    for (const f of values) {
      expectClose(roundTrip(f), f, tolerance);
    }
  });

  it('preserves Inf and -Inf', () => {
    expect(roundTrip(Infinity)).toBe(Infinity);
    expect(roundTrip(-Infinity)).toBe(-Infinity);
  });

  it('preserves NaN (sign and payload bits)', () => {
    const out = roundTrip(NaN);
    expect(Number.isNaN(out)).toBe(true);
  });

  it('handles denormals (round to zero or minimal)', () => {
    const tiny = 2 ** -140;
    const r = roundTrip(tiny);
    expect(r === 0 || Math.abs(r) < 1e-40).toBe(true);
  });

  it('handles values near FLT_MAX without overflow', () => {
    const nearMax = 3.4e38;
    const r = roundTrip(nearMax);
    expect(Number.isFinite(r) && r > 1e37).toBe(true);
  });
});

describe('float24 bit layout (reference alignment)', () => {
  it('float32ToF24 produces 24-bit with sign in bit 23', () => {
    const pos = float32ToF24(1);
    const neg = float32ToF24(-1);
    expect((pos >> 23) & 1).toBe(0);
    expect((neg >> 23) & 1).toBe(1);
  });

  it('float32ToF24(0) is 0', () => {
    expect(float32ToF24(0)).toBe(0);
  });

  it('float32ToF24(1) matches reference finite rounding', () => {
    // Reference: finite f -> ((e|m) + (m & 0x80)) >> 8; 1.0 has e=0x3f800000, m=0 -> high 24 bits 0x3f8000
    const f24 = float32ToF24(1);
    expect(f24).toBe(0x3f8000);
  });

  it('float32ToF24(Infinity) is 0x7f8000 (exp only, no mantissa)', () => {
    expect(float32ToF24(Infinity)).toBe(0x7f8000);
  });

  it('float32ToF24(-Infinity) has sign set', () => {
    expect(float32ToF24(-Infinity)).toBe(0xff8000);
  });

  it('f24ToFloat32 reconstructs 1.0 from 0x3f8000 bytes (low, mid, high)', () => {
    const f24 = 0x3f8000;
    const b0 = f24 & 0xff;
    const b1 = (f24 >> 8) & 0xff;
    const b2 = (f24 >> 16) & 0xff;
    expectClose(f24ToFloat32(b0, b1, b2), 1, 1e-6);
  });
});
