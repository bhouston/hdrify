import { describe, expect, it } from 'vitest';
import { compressB44Block } from './compressB44.js';
import { decompressB44 } from './decompressB44.js';
import { HALF } from './exrConstants.js';
import { decodeFloat16, encodeFloat16 } from './halfFloat.js';
import type { ExrChannel } from './exrTypes.js';

const RGB_CHANNELS: ExrChannel[] = [
  { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'G', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'B', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
];

/** Build channel-major-per-scanline half-float bytes: for line, for channel, for x. */
function buildPlanar(
  width: number,
  lineCount: number,
  channels: ExrChannel[],
  value: (c: number, x: number, y: number) => number,
): Uint8Array {
  const numChannels = channels.length;
  const out = new Uint8Array(width * lineCount * numChannels * 2);
  const view = new DataView(out.buffer);
  for (let ly = 0; ly < lineCount; ly++) {
    for (let c = 0; c < numChannels; c++) {
      for (let x = 0; x < width; x++) {
        const offset = (ly * numChannels * width + c * width + x) * 2;
        view.setUint16(offset, encodeFloat16(value(c, x, ly)), true);
      }
    }
  }
  return out;
}

function readPlanarValue(
  planar: Uint8Array,
  width: number,
  channels: ExrChannel[],
  c: number,
  x: number,
  y: number,
): number {
  const numChannels = channels.length;
  const offset = (y * numChannels * width + c * width + x) * 2;
  const view = new DataView(planar.buffer, planar.byteOffset, planar.byteLength);
  return decodeFloat16(view.getUint16(offset, true));
}

describe('compressB44Block / decompressB44', () => {
  it('round-trips an 8x8 gradient (exact block multiples of 4)', () => {
    const width = 8;
    const lineCount = 8;
    const planar = buildPlanar(width, lineCount, RGB_CHANNELS, (c, x, y) => (x + y * width + c * 3) / 100);

    const compressed = compressB44Block(planar, width, lineCount, RGB_CHANNELS, false);
    const decompressed = decompressB44(compressed, width, RGB_CHANNELS, compressed.length, lineCount);

    expect(decompressed.length).toBe(planar.length);
    for (let y = 0; y < lineCount; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 3; c++) {
          const original = readPlanarValue(planar, width, RGB_CHANNELS, c, x, y);
          const decoded = readPlanarValue(decompressed, width, RGB_CHANNELS, c, x, y);
          expect(Math.abs(decoded - original)).toBeLessThan(0.05);
        }
      }
    }
  });

  it('round-trips dimensions that are not multiples of 4 (edge padding)', () => {
    const width = 7;
    const lineCount = 5;
    const planar = buildPlanar(width, lineCount, RGB_CHANNELS, (c, x, y) => (x + y * width + c * 3) / 50);

    const compressed = compressB44Block(planar, width, lineCount, RGB_CHANNELS, false);
    const decompressed = decompressB44(compressed, width, RGB_CHANNELS, compressed.length, lineCount);

    expect(decompressed.length).toBe(planar.length);
    for (let y = 0; y < lineCount; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 3; c++) {
          const original = readPlanarValue(planar, width, RGB_CHANNELS, c, x, y);
          const decoded = readPlanarValue(decompressed, width, RGB_CHANNELS, c, x, y);
          expect(Math.abs(decoded - original)).toBeLessThan(0.1);
        }
      }
    }
  });

  it('B44A (flatFields=true) produces a smaller stream than B44 for a constant image', () => {
    const width = 8;
    const lineCount = 8;
    const planar = buildPlanar(width, lineCount, RGB_CHANNELS, () => 0.5);

    const b44 = compressB44Block(planar, width, lineCount, RGB_CHANNELS, false);
    const b44a = compressB44Block(planar, width, lineCount, RGB_CHANNELS, true);

    expect(b44a.length).toBeLessThan(b44.length);

    const decompressed = decompressB44(b44a, width, RGB_CHANNELS, b44a.length, lineCount);
    for (let i = 0; i < decompressed.length; i += 2) {
      const view = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
      expect(decodeFloat16(view.getUint16(i, true))).toBeCloseTo(0.5, 2);
    }
  });

  it('round-trips a single 4x4 block exactly', () => {
    const width = 4;
    const lineCount = 4;
    const planar = buildPlanar(width, lineCount, RGB_CHANNELS, (c, x, y) => (x - y + c) / 20);

    const compressed = compressB44Block(planar, width, lineCount, RGB_CHANNELS, false);
    expect(compressed.length).toBe(3 * 14); // one 14-byte block per channel
    const decompressed = decompressB44(compressed, width, RGB_CHANNELS, compressed.length, lineCount);
    for (let i = 0; i < planar.length; i += 2) {
      const view = new DataView(planar.buffer, planar.byteOffset, planar.byteLength);
      const dview = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
      const original = decodeFloat16(view.getUint16(i, true));
      const decoded = decodeFloat16(dview.getUint16(i, true));
      expect(Math.abs(decoded - original)).toBeLessThan(0.05);
    }
  });
});
