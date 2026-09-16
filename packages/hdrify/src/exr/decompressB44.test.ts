import { describe, expect, it } from 'vitest';
import { packB44Block } from './b44Codec.js';
import { decompressB44 } from './decompressB44.js';
import { FLOAT, HALF, UINT } from './exrConstants.js';
import { encodeFloat16 } from './halfFloat.js';
import type { ExrChannel } from './exrTypes.js';

describe('decompressB44', () => {
  it('copies FLOAT and UINT channels through uncompressed', () => {
    const width = 2;
    const lineCount = 2;
    const channels: ExrChannel[] = [
      { name: 'A', pixelType: UINT, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
      { name: 'Z', pixelType: FLOAT, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
    ];

    const uintBytes = width * lineCount * 4;
    const floatBytes = width * lineCount * 4;
    const compressed = new Uint8Array(uintBytes + floatBytes);
    const view = new DataView(compressed.buffer);
    for (let i = 0; i < width * lineCount; i++) {
      view.setUint32(i * 4, 1000 + i, true);
      view.setFloat32(uintBytes + i * 4, 1.5 + i, true);
    }

    const decompressed = decompressB44(compressed, width, channels, compressed.length, lineCount);
    const outView = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);

    // Output is channel-planar, line-major: for each line, channel A's 2 samples then channel Z's 2 samples.
    expect(outView.getUint32(0, true)).toBe(1000);
    expect(outView.getUint32(4, true)).toBe(1001);
    expect(outView.getFloat32(8, true)).toBeCloseTo(1.5);
    expect(outView.getFloat32(12, true)).toBeCloseTo(2.5);
  });

  it('decodes a hand-packed 4x4 HALF block', () => {
    const width = 4;
    const lineCount = 4;
    const channels: ExrChannel[] = [
      { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
    ];

    const values = Array.from({ length: 16 }, (_, i) => i / 32);
    const s = Uint16Array.from(values.map(encodeFloat16));
    const block = new Uint8Array(14);
    packB44Block(s, block, false, true);

    const decompressed = decompressB44(block, width, channels, block.length, lineCount);
    const view = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
    // Spot-check a couple of samples decode close to their originals (within B44 quantization).
    const decodeHalf = (offset: number) => {
      const bits = view.getUint16(offset, true);
      const sign = bits & 0x8000 ? -1 : 1;
      const exp = (bits >> 10) & 0x1f;
      const mant = bits & 0x3ff;
      if (exp === 0) return sign * (mant / 1024) * 2 ** -14;
      return sign * (1 + mant / 1024) * 2 ** (exp - 15);
    };
    expect(decodeHalf(0)).toBeCloseTo(0, 1);
    expect(decodeHalf(30)).toBeCloseTo(15 / 32, 1);
  });

  it('throws on truncated block data', () => {
    const width = 4;
    const lineCount = 4;
    const channels: ExrChannel[] = [
      { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
    ];
    const truncated = new Uint8Array(2); // less than the 3-byte minimum
    expect(() => decompressB44(truncated, width, channels, truncated.length, lineCount)).toThrow();
  });
});
