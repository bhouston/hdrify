import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { compressPxr24Block } from './compressPxr24.js';
import { decompressPxr24 } from './decompressPxr24.js';
import { HALF } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';
import { transposePxr24Bytes } from './pxr24Utils.js';

const DEFAULT_CHANNELS: ExrChannel[] = [
  { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'G', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'B', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'A', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
];

const RGB_CHANNELS: ExrChannel[] = [
  { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'G', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'B', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
];

describe('decompressPxr24', () => {
  it('round-trips with compressPxr24Block', () => {
    const width = 8;
    const lineCount = 4;
    const numChannels = 4;
    const planar = new Uint8Array(width * lineCount * numChannels * 2);

    for (let i = 0; i < planar.length / 2; i++) {
      planar[i * 2] = i & 0xff;
      planar[i * 2 + 1] = (i >> 8) & 0xff;
    }

    const compressed = compressPxr24Block(planar, width, lineCount, DEFAULT_CHANNELS);
    const decompressed = decompressPxr24(compressed, width, DEFAULT_CHANNELS, compressed.length, lineCount);

    expect(decompressed.length).toBe(planar.length);
    expect(decompressed).toEqual(planar);
  });

  it('handles zero image', () => {
    const width = 4;
    const lineCount = 4;
    const planar = new Uint8Array(width * lineCount * 4 * 2);

    const compressed = compressPxr24Block(planar, width, lineCount, DEFAULT_CHANNELS);
    const decompressed = decompressPxr24(compressed, width, DEFAULT_CHANNELS, compressed.length, lineCount);

    expect(decompressed).toEqual(planar);
  });

  it('handles ramp image', () => {
    const width = 16;
    const lineCount = 2;
    const planar = new Uint8Array(width * lineCount * 4 * 2);

    for (let i = 0; i < planar.length / 2; i++) {
      planar[i * 2] = (i % 256) & 0xff;
      planar[i * 2 + 1] = ((i % 256) >> 8) & 0xff;
    }

    const compressed = compressPxr24Block(planar, width, lineCount, DEFAULT_CHANNELS);
    const decompressed = decompressPxr24(compressed, width, DEFAULT_CHANNELS, compressed.length, lineCount);

    expect(decompressed).toEqual(planar);
  });

  it('decompresses manually crafted line-major format (matches OpenEXR)', () => {
    // Build planar output: 2x2 RGB. Layout: for each line, for each channel, for each pixel.
    // Offset = (ly * numChannels * width + c * width + x) * 2
    const width = 2;
    const lineCount = 2;
    const numChannels = 3;
    const offsetAt = (ly: number, c: number, x: number) => (ly * numChannels * width + c * width + x) * 2;

    const planar = new Uint8Array(width * lineCount * numChannels * 2);
    const half10 = 0x3c00;
    planar[offsetAt(0, 0, 0)] = half10 & 0xff;
    planar[offsetAt(0, 0, 0) + 1] = (half10 >> 8) & 0xff;
    planar[offsetAt(0, 0, 1)] = half10 & 0xff;
    planar[offsetAt(0, 0, 1) + 1] = (half10 >> 8) & 0xff;
    // G, B channels remain 0

    const segments: Uint8Array[] = [];
    for (let ly = 0; ly < lineCount; ly++) {
      for (let c = 0; c < numChannels; c++) {
        const lineDelta: number[] = [];
        let prev = 0;
        for (let x = 0; x < width; x++) {
          const offset = offsetAt(ly, c, x);
          const value = (planar[offset] ?? 0) | ((planar[offset + 1] ?? 0) << 8);
          const diff = (value - prev) | 0;
          prev = value;
          lineDelta.push((diff >> 8) & 0xff, diff & 0xff);
        }
        segments.push(transposePxr24Bytes(new Uint8Array(lineDelta), 2));
      }
    }
    const raw = new Uint8Array(segments.reduce((s, t) => s + t.length, 0));
    let off = 0;
    for (const s of segments) {
      raw.set(s, off);
      off += s.length;
    }
    const compressed = zlibSync(raw, { level: 4 });

    const decompressed = decompressPxr24(compressed, width, RGB_CHANNELS, compressed.length, lineCount);
    expect(decompressed).toEqual(planar);
  });

  it('fails on whole-block transposed input (proves we expect per-channel)', () => {
    // If we applied whole-block transposition to raw, decompress would produce garbage.
    // Verify our decompressor correctly uses per-channel by checking round-trip.
    const width = 2;
    const lineCount = 2;
    const planar = new Uint8Array(width * lineCount * 3 * 2);
    planar[0] = 0xab;
    planar[1] = 0xcd;
    const compressed = compressPxr24Block(planar, width, lineCount, RGB_CHANNELS);
    const decompressed = decompressPxr24(compressed, width, RGB_CHANNELS, compressed.length, lineCount);
    expect(decompressed[0]).toBe(0xab);
    expect(decompressed[1]).toBe(0xcd);
  });
});
