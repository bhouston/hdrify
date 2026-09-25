/**
 * Unit tests for the core B44/B44A 4x4-block codec.
 * Reference behavior transcribed from OpenEXR's internal_b44.c; the
 * `unpack14` output for the first block of assets/example_b44.exr was
 * cross-checked byte-for-byte against a standalone C build of that
 * reference during development.
 */

import { describe, expect, it } from 'vitest';
import { decodeFloat16, encodeFloat16 } from './halfFloat.js';
import { packB44Block, unpackB44Block14, unpackB44Block3 } from './b44Codec.js';

function packAndUnpack(values: number[], flatFields: boolean): { wcount: number; decoded: number[] } {
  const s = Uint16Array.from(values.map(encodeFloat16));
  const out = new Uint8Array(14);
  const wcount = packB44Block(s, out, flatFields, true);
  const s2 = new Uint16Array(16);
  if (wcount === 3) {
    unpackB44Block3(out, s2);
  } else {
    unpackB44Block14(out, s2);
  }
  return { wcount, decoded: Array.from(s2).map(decodeFloat16) };
}

describe('b44Codec', () => {
  it('round-trips a smooth gradient block within B44 quantization tolerance', () => {
    const values = [0.1, 0.2, 0.15, 0.18, 0.3, 0.25, 0.22, 0.28, 0.4, 0.35, 0.32, 0.38, 0.5, 0.45, 0.42, 0.48];
    const { wcount, decoded } = packAndUnpack(values, false);
    expect(wcount).toBe(14);
    for (let i = 0; i < 16; i++) {
      expect(decoded[i]).toBeCloseTo(values[i]!, 1);
    }
  });

  it('packs a constant block into 3 bytes when flatFields (B44A) is set', () => {
    const values = Array.from({ length: 16 }).fill(0.5);
    const { wcount, decoded } = packAndUnpack(values, true);
    expect(wcount).toBe(3);
    for (const v of decoded) {
      expect(v).toBeCloseTo(0.5, 2);
    }
  });

  it('does not use the 3-byte flat encoding for a constant block when flatFields (B44) is false', () => {
    const values = Array.from({ length: 16 }).fill(0.5);
    const { wcount } = packAndUnpack(values, false);
    expect(wcount).toBe(14);
  });

  it('round-trips negative values', () => {
    const values = [
      -0.1, -0.2, -0.15, -0.18, -0.3, -0.25, -0.22, -0.28, -0.4, -0.35, -0.32, -0.38, -0.5, -0.45, -0.42, -0.48,
    ];
    const { decoded } = packAndUnpack(values, false);
    for (let i = 0; i < 16; i++) {
      expect(decoded[i]).toBeCloseTo(values[i]!, 1);
    }
  });

  it('round-trips a mix of positive, negative, and zero values of similar magnitude', () => {
    // B44 quantizes each block relative to its own max magnitude, so values spanning
    // wildly different orders of magnitude in one block lose precision by design;
    // keep this block's dynamic range realistic (as in a natural-image gradient).
    const values = [0, -0, 1, -1, 0.9, -0.9, 0.5, -0.5, 0.75, -0.75, 0.2, -0.2, 0.6, -0.6, 0.25, -0.25];
    const { decoded } = packAndUnpack(values, false);
    for (let i = 0; i < 16; i++) {
      expect(Math.abs(decoded[i]! - values[i]!)).toBeLessThan(0.3);
    }
  });

  it('collapses NaN and Infinity to zero (matching OpenEXR reference behavior)', () => {
    const values = [NaN, Infinity, -Infinity, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const { decoded } = packAndUnpack(values, false);
    expect(decoded[0]).toBe(0);
    expect(decoded[1]).toBe(0);
    expect(decoded[2]).toBe(0);
  });

  it('exactly reproduces HALF_MAX for a block containing it (exactMax)', () => {
    const halfMax = 65504;
    const values = [halfMax, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const { decoded } = packAndUnpack(values, false);
    expect(decoded[0]).toBe(halfMax);
  });

  it('matches the known-good decode of the first block of assets/example_b44.exr', () => {
    // Raw 14-byte B44 block extracted from the real fixture (channel B, block (0,0)),
    // decoded here to confirm the shared s[] output convention (index = row*4 + col).
    const bytes = Uint8Array.from([0xb7, 0xb4, 0x0d, 0xe8, 0x59, 0x8e, 0x58, 0xe7, 0x8d, 0xe6, 0xa3, 0x38, 0xf5, 0x54]);
    const s = new Uint16Array(16);
    unpackB44Block14(bytes, s);
    // First sample corresponds to pixel (0,0)'s B channel; verified against
    // OpenImageIO's decode of assets/example_b44.exr (B = 0.481445).
    expect(decodeFloat16(s[0]!)).toBeCloseTo(0.481445, 5);
  });
});
