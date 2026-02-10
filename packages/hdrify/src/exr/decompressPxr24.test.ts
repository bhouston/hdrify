import { describe, expect, it } from 'vitest';
import { compressPxr24Block } from './compressPxr24.js';
import { decompressPxr24 } from './decompressPxr24.js';
import { HALF } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';

const DEFAULT_CHANNELS: ExrChannel[] = [
  { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'G', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'B', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'A', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
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
});
