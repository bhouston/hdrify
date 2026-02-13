/**
 * Isolated validation of the PXR24 block/line decoder.
 *
 * These tests build the compressed payload BY HAND to match the OpenEXR/C++
 * layout exactly (line-major order, per-segment transpose, deltas stored
 * with high byte first). No use of our encoder — so we validate the
 * decoder against known-good inputs.
 *
 * Layout (OpenEXR reference):
 * - After zlib: for each scanline ly, for each channel c, one segment of
 *   (width * bytesPerSample) bytes.
 * - Each segment is transposed: stored as [all_byte0][all_byte1] (for HALF:
 *   [all_high][all_low]). So for 2 pixels, segment = [h0,h1, l0,l1].
 * - Each delta is signed 16-bit; in the segment (before transpose) we store
 *   high byte first: (diff >> 8), (diff & 0xff). So after transpose we have
 *   high bytes first in the segment, then low bytes.
 */

import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decompressPxr24 } from './decompressPxr24.js';
import { HALF } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';
import { transposePxr24Bytes } from './pxr24Utils.js';

const RGB_CHANNELS: ExrChannel[] = [
  { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'G', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'B', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
];

/**
 * Build one segment (one line of one channel) in OpenEXR/C++ format:
 * - deltas as signed 16-bit, stored high byte first: [hi0, lo0, hi1, lo1, ...]
 * - then transpose to [hi0, hi1, ..., lo0, lo1, ...]
 */
function buildSegmentLineMajorCxxOrder(width: number, deltas: number[]): Uint8Array {
  const segmentSize = width * 2;
  const raw = new Uint8Array(segmentSize);
  for (let x = 0; x < width; x++) {
    const diff = deltas[x] ?? 0;
    const u16 = diff & 0xffff;
    raw[x * 2] = (u16 >> 8) & 0xff;
    raw[x * 2 + 1] = u16 & 0xff;
  }
  return transposePxr24Bytes(raw, 2);
}

describe('PXR24 block decoder (isolated, known-good inputs)', () => {
  it('decodes a single line, single channel with known deltas', () => {
    const width = 2;
    const lineCount = 1;

    // Expected output: two half values 1.0, 0.5 (0x3c00, 0x3800). Planar layout:
    // one line, one channel: [0x00,0x3c, 0x00,0x38]
    const expected = new Uint8Array(4);
    expected[0] = 0x00;
    expected[1] = 0x3c;
    expected[2] = 0x00;
    expected[3] = 0x38;

    // Deltas: 0x3c00 - 0 = 0x3c00; 0x3800 - 0x3c00 = -0x400 -> 0xfc00 as u16
    const deltas = [0x3c00, 0xfc00];
    const segment = buildSegmentLineMajorCxxOrder(width, deltas);
    const raw = new Uint8Array(segment.length);
    raw.set(segment);
    const compressed = zlibSync(raw);

    const channels: ExrChannel[] = [
      { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
    ];
    const out = decompressPxr24(compressed, width, channels, compressed.length, lineCount);

    expect(out.length).toBe(4);
    expect(out[0]).toBe(expected[0]);
    expect(out[1]).toBe(expected[1]);
    expect(out[2]).toBe(expected[2]);
    expect(out[3]).toBe(expected[3]);
  });

  it('decodes 2x2 RGB line-major payload (hand-built, C++ byte order)', () => {
    const width = 2;
    const lineCount = 2;
    const numChannels = 3;

    // Expected planar output: for each line, for each channel, for each pixel (2 bytes LE per half).
    // We want: R line0 = [1.0, 0.5] = 0x3c00, 0x3800; rest zeros.
    const expected = new Uint8Array(width * lineCount * numChannels * 2);
    const setHalf = (offset: number, value: number) => {
      expected[offset] = value & 0xff;
      expected[offset + 1] = (value >> 8) & 0xff;
    };
    const offsetAt = (ly: number, c: number, x: number) => (ly * numChannels * width + c * width + x) * 2;

    setHalf(offsetAt(0, 0, 0), 0x3c00);
    setHalf(offsetAt(0, 0, 1), 0x3800);
    setHalf(offsetAt(1, 0, 0), 0x3800);
    setHalf(offsetAt(1, 0, 1), 0);

    const segments: Uint8Array[] = [];

    for (let ly = 0; ly < lineCount; ly++) {
      for (let c = 0; c < numChannels; c++) {
        const deltas: number[] = [];
        let prev = 0;
        for (let x = 0; x < width; x++) {
          const off = offsetAt(ly, c, x);
          const value = (expected[off] ?? 0) | ((expected[off + 1] ?? 0) << 8);
          const diff = (value - prev) | 0;
          prev = value;
          deltas.push(diff);
        }
        segments.push(buildSegmentLineMajorCxxOrder(width, deltas));
      }
    }

    let totalLen = 0;
    for (const s of segments) totalLen += s.length;
    const raw = new Uint8Array(totalLen);
    let off = 0;
    for (const s of segments) {
      raw.set(s, off);
      off += s.length;
    }
    const compressed = zlibSync(raw);

    const out = decompressPxr24(compressed, width, RGB_CHANNELS, compressed.length, lineCount);

    expect(out.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(out[i]).toBe(expected[i]);
    }
  });

  it('decodes all-zero block', () => {
    const width = 4;
    const lineCount = 2;
    const expected = new Uint8Array(width * lineCount * 3 * 2);

    const segments: Uint8Array[] = [];
    for (let ly = 0; ly < lineCount; ly++) {
      for (let c = 0; c < 3; c++) {
        segments.push(buildSegmentLineMajorCxxOrder(width, [0, 0, 0, 0]));
      }
    }
    let totalLen = 0;
    for (const s of segments) totalLen += s.length;
    const raw = new Uint8Array(totalLen);
    let off = 0;
    for (const s of segments) {
      raw.set(s, off);
      off += s.length;
    }
    const compressed = zlibSync(raw);
    const out = decompressPxr24(compressed, width, RGB_CHANNELS, compressed.length, lineCount);

    expect(out.length).toBe(expected.length);
    expect(out).toEqual(expected);
  });

  it('decodes ramp (1,2,3,4) in one channel', () => {
    const width = 4;
    const lineCount = 1;
    const values = [1, 2, 3, 4];
    const expected = new Uint8Array(width * 2);
    for (let x = 0; x < width; x++) {
      const v = values[x] ?? 0;
      expected[x * 2] = v & 0xff;
      expected[x * 2 + 1] = (v >> 8) & 0xff;
    }
    const deltas = [
      values[0] ?? 0,
      (values[1] ?? 0) - (values[0] ?? 0),
      (values[2] ?? 0) - (values[1] ?? 0),
      (values[3] ?? 0) - (values[2] ?? 0),
    ];
    const segment = buildSegmentLineMajorCxxOrder(width, deltas);
    const compressed = zlibSync(segment);
    const channels: ExrChannel[] = [
      { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
    ];
    const out = decompressPxr24(compressed, width, channels, compressed.length, lineCount);
    expect(out).toEqual(expected);
  });
});
