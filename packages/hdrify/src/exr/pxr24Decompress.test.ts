/**
 * Unit tests for PXR24 decompression components.
 * Isolates delta decode, transposition, and layout to find external-format mismatches.
 */
import { unzlibSync, zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { compressPxr24Block } from './compressPxr24.js';
import { decompressPxr24 } from './decompressPxr24.js';
import { HALF } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';
import { transposePxr24Bytes, undoPxr24Transposition } from './pxr24Utils.js';

const RGBA_CHANNELS: ExrChannel[] = [
  { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'G', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'B', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'A', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
];

const _RGB_CHANNELS: ExrChannel[] = [
  { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'G', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'B', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
];

describe('PXR24 delta encoding', () => {
  it('delta encodes ramp correctly: diff[i] = value[i] - value[i-1]', () => {
    const width = 4;
    const lineCount = 1;
    const numChannels = 1;
    const planar = new Uint8Array(width * lineCount * numChannels * 2);
    // Values 0, 1, 2, 3 as little-endian half
    for (let i = 0; i < 4; i++) {
      planar[i * 2] = i & 0xff;
      planar[i * 2 + 1] = (i >> 8) & 0xff;
    }
    const compressed = compressPxr24Block(planar, width, lineCount, [
      { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
    ]);
    const raw = unzlibSync(compressed);
    const untransposed = undoPxr24Transposition(raw, 2);
    // Encoder stores delta high byte first: [d0_hi,d0_lo, d1_hi,d1_lo, ...]. After undo: [d0_hi,d0_lo, d1_hi,d1_lo, ...]
    // Deltas: 0, 1, 1, 1 (prev=0 per segment). So bytes: (0,0), (0,1), (0,1), (0,1)
    expect(untransposed[0]).toBe(0);
    expect(untransposed[1]).toBe(0);
    expect(untransposed[2]).toBe(0);
    expect(untransposed[3]).toBe(1);
    expect(untransposed[4]).toBe(0);
    expect(untransposed[5]).toBe(1);
    expect(untransposed[6]).toBe(0);
    expect(untransposed[7]).toBe(1);
  });

  it('delta decode reconstructs original from untransposed bytes', () => {
    const width = 2;
    const lineCount = 2;
    const planar = new Uint8Array(width * lineCount * 4 * 2);
    for (let i = 0; i < planar.length / 2; i++) {
      planar[i * 2] = i & 0xff;
      planar[i * 2 + 1] = (i >> 8) & 0xff;
    }
    const compressed = compressPxr24Block(planar, width, lineCount, RGBA_CHANNELS);
    const decompressed = decompressPxr24(compressed, width, RGBA_CHANNELS, compressed.length, lineCount);
    expect(decompressed).toEqual(planar);
  });
});

describe('PXR24 output layout for readExr', () => {
  // readExr expects planar: for each line, for each channel, for each pixel
  // pixelOffset = lineOffset + c * width * bytesPerChannel + x * bytesPerChannel
  it('output byte at (line, channel, x) is at correct offset', () => {
    const width = 4;
    const lineCount = 2;
    const bytesPerChannel = 2;
    const planar = new Uint8Array(width * lineCount * 4 * bytesPerChannel);
    // Fill with deterministic pattern: line 0 R channel = [0,1,2,3], line 0 G = [4,5,6,7], etc.
    for (let i = 0; i < planar.length; i++) {
      planar[i] = i & 0xff;
    }
    const compressed = compressPxr24Block(planar, width, lineCount, RGBA_CHANNELS);
    const decompressed = decompressPxr24(compressed, width, RGBA_CHANNELS, compressed.length, lineCount);

    const bytesPerScanline = width * 4 * bytesPerChannel;
    for (let ly = 0; ly < lineCount; ly++) {
      for (let c = 0; c < 4; c++) {
        for (let x = 0; x < width; x++) {
          const expectedOffset = ly * bytesPerScanline + c * width * bytesPerChannel + x * bytesPerChannel;
          const actualOffset = ly * bytesPerScanline + c * width * bytesPerChannel + x * bytesPerChannel;
          expect(decompressed[actualOffset]).toBe(planar[expectedOffset]);
          expect(decompressed[actualOffset + 1]).toBe(planar[expectedOffset + 1]);
        }
      }
    }
  });
});

describe('PXR24 per-channel vs whole-block transposition', () => {
  /** Build raw buffer in same order as our encoder: line-major, prev=0 per segment, high byte first. */
  function compressLineMajorOpenEXRFormat(
    planar: Uint8Array,
    width: number,
    lineCount: number,
    channels: ExrChannel[],
  ): Uint8Array {
    const numChannels = channels.length;
    const bytesPerSample = 2;
    const segments: Uint8Array[] = [];

    for (let ly = 0; ly < lineCount; ly++) {
      for (let c = 0; c < numChannels; c++) {
        let prev = 0;
        const lineDelta: number[] = [];
        for (let x = 0; x < width; x++) {
          const offset = (ly * numChannels * width + c * width + x) * bytesPerSample;
          const value = (planar[offset] ?? 0) | ((planar[offset + 1] ?? 0) << 8);
          const diff = (value - prev) & 0xffff;
          prev = value;
          lineDelta.push((diff >> 8) & 0xff, diff & 0xff);
        }
        segments.push(transposePxr24Bytes(new Uint8Array(lineDelta), bytesPerSample));
      }
    }
    const raw = new Uint8Array(segments.reduce((s, t) => s + t.length, 0));
    let off = 0;
    for (const p of segments) {
      raw.set(p, off);
      off += p.length;
    }
    return zlibSync(raw, { level: 4 });
  }

  it('our compress uses line-major per-segment transposition (OpenEXR format)', () => {
    const width = 2;
    const lineCount = 2;
    const planar = new Uint8Array(width * lineCount * 4 * 2);
    planar[0] = 1;
    planar[1] = 0;
    const ourCompressed = compressPxr24Block(planar, width, lineCount, RGBA_CHANNELS);
    const lineMajorCompressed = compressLineMajorOpenEXRFormat(planar, width, lineCount, RGBA_CHANNELS);
    expect(ourCompressed).toEqual(lineMajorCompressed);
  });

  it('decompress handles our whole-block format', () => {
    const width = 2;
    const lineCount = 2;
    const planar = new Uint8Array(width * lineCount * 4 * 2);
    for (let i = 0; i < planar.length / 2; i++) {
      planar[i * 2] = i & 0xff;
      planar[i * 2 + 1] = (i >> 8) & 0xff;
    }
    const compressed = compressPxr24Block(planar, width, lineCount, RGBA_CHANNELS);
    const out = decompressPxr24(compressed, width, RGBA_CHANNELS, compressed.length, lineCount);
    expect(out).toEqual(planar);
  });
});
