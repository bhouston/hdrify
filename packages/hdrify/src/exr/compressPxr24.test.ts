import { describe, expect, it } from 'vitest';
import { compressPxr24Block } from './compressPxr24.js';
import { decompressPxr24 } from './decompressPxr24.js';
import { HALF } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';
import { float32ToF24, f24ToFloat32 } from './pxr24Utils.js';

const DEFAULT_CHANNELS: ExrChannel[] = [
  { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'G', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'B', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'A', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
];

describe('compressPxr24Block', () => {
  it('round-trips with decompressPxr24', () => {
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

    expect(decompressed).toEqual(planar);
  });

  it('f24 conversion round-trips within tolerance', () => {
    const values = [0.0, 0.5, 1.0, 2.0, 0.25, 0.00390625, -1.0];
    for (const f of values) {
      const f24 = float32ToF24(f);
      const b0 = f24 & 0xff;
      const b1 = (f24 >> 8) & 0xff;
      const b2 = (f24 >> 16) & 0xff;
      const back = f24ToFloat32(b0, b1, b2);
      expect(Math.abs(back - f)).toBeLessThan(1e-5);
    }
  });

  it('produces smaller output for uniform data', () => {
    const width = 32;
    const lineCount = 16;
    const planar = new Uint8Array(width * lineCount * 4 * 2);
    // All zeros - should compress well
    const compressed = compressPxr24Block(planar, width, lineCount, DEFAULT_CHANNELS);
    expect(compressed.length).toBeLessThan(planar.length);
  });
});
