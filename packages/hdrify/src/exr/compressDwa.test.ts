import { describe, expect, it } from 'vitest';
import { compressDwaBlock } from './compressDwa.js';
import { decompressDwa } from './decompressDwa.js';
import { FLOAT, HALF } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';
import { decodeFloat16, encodeFloat16 } from './halfFloat.js';

const RGBA_HALF: ExrChannel[] = [
  { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'G', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'B', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'A', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
];

const RGBA_FLOAT: ExrChannel[] = RGBA_HALF.map((ch) => ({ ...ch, pixelType: FLOAT }));

/**
 * Build a scanline-major, channel-major-per-scanline raw buffer (the convention shared by
 * compressDwaBlock/decompressDwa and every other EXR block (de)compressor in this codebase):
 * for each scanline, for each channel, width values.
 */
function buildRaw(
  width: number,
  height: number,
  channels: ExrChannel[],
  valueFn: (x: number, y: number, c: number) => number,
): Uint8Array {
  const bpe = channels.map((ch) => (ch.pixelType === HALF ? 2 : 4));
  let total = 0;
  for (const b of bpe) total += width * height * b;
  const raw = new Uint8Array(total);
  const dv = new DataView(raw.buffer);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < channels.length; c++) {
      const isFloat = channels[c]!.pixelType === FLOAT;
      for (let x = 0; x < width; x++) {
        const v = valueFn(x, y, c);
        if (isFloat) {
          dv.setFloat32(offset, v, true);
          offset += 4;
        } else {
          dv.setUint16(offset, encodeFloat16(v), true);
          offset += 2;
        }
      }
    }
  }
  return raw;
}

function maxAbsError(
  a: Uint8Array,
  b: Uint8Array,
  width: number,
  height: number,
  channels: ExrChannel[],
  channelFilter?: (c: number) => boolean,
): number {
  const dvA = new DataView(a.buffer, a.byteOffset, a.byteLength);
  const dvB = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let offset = 0;
  let maxErr = 0;
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < channels.length; c++) {
      const isFloat = channels[c]!.pixelType === FLOAT;
      for (let x = 0; x < width; x++) {
        const va = isFloat ? dvA.getFloat32(offset, true) : decodeFloat16(dvA.getUint16(offset, true));
        const vb = isFloat ? dvB.getFloat32(offset, true) : decodeFloat16(dvB.getUint16(offset, true));
        if (!channelFilter || channelFilter(c)) {
          maxErr = Math.max(maxErr, Math.abs(va - vb));
        }
        offset += isFloat ? 4 : 2;
      }
    }
  }
  return maxErr;
}

function roundTrip(
  width: number,
  height: number,
  channels: ExrChannel[],
  valueFn: (x: number, y: number, c: number) => number,
): { raw: Uint8Array; decompressed: Uint8Array; compressed: Uint8Array } {
  const raw = buildRaw(width, height, channels, valueFn);
  const compressed = compressDwaBlock(raw, width, height, channels);
  const decompressed = decompressDwa(compressed, width, channels, compressed.length, height);
  return { raw, decompressed, compressed };
}

describe('compressDwaBlock + decompressDwa (RGB DCT + CSC path)', () => {
  it('round-trips an exact single 8x8 block within half-float DCT precision', () => {
    const { raw, decompressed } = roundTrip(8, 8, RGBA_HALF, (x, y, c) =>
      c === 3 ? 1 : Math.sin(x * 0.4) * 0.5 + Math.cos(y * 0.3) * 0.3 + c * 0.05,
    );
    expect(decompressed.length).toBe(raw.length);
    expect(maxAbsError(raw, decompressed, 8, 8, RGBA_HALF, (c) => c !== 3)).toBeLessThan(0.003);
  });

  it('round-trips multiple full blocks (width/height multiples of 8)', () => {
    const { raw, decompressed } = roundTrip(32, 24, RGBA_HALF, (x, y, c) =>
      c === 3 ? 1 : ((x + y) % 17) / 17 + c * 0.02,
    );
    expect(decompressed.length).toBe(raw.length);
    expect(maxAbsError(raw, decompressed, 32, 24, RGBA_HALF, (c) => c !== 3)).toBeLessThan(0.003);
  });

  it('round-trips dimensions that are not multiples of 8 (partial edge blocks)', () => {
    const { raw, decompressed } = roundTrip(13, 19, RGBA_HALF, (x, y, c) =>
      c === 3 ? 1 : Math.sin(x * 0.3) * 0.5 + Math.cos(y * 0.2) * 0.3 + c * 0.05,
    );
    expect(decompressed.length).toBe(raw.length);
    expect(maxAbsError(raw, decompressed, 13, 19, RGBA_HALF, (c) => c !== 3)).toBeLessThan(0.003);
  });

  it('round-trips a single pixel (smaller than one DCT block)', () => {
    const { raw, decompressed } = roundTrip(1, 1, RGBA_HALF, (_x, _y, c) => (c === 3 ? 1 : 0.3 + c * 0.1));
    expect(decompressed.length).toBe(raw.length);
    expect(maxAbsError(raw, decompressed, 1, 1, RGBA_HALF, (c) => c !== 3)).toBeLessThan(0.003);
  });

  it('round-trips a uniform (flat) block essentially exactly', () => {
    const { raw, decompressed } = roundTrip(16, 16, RGBA_HALF, (_x, _y, c) => (c === 3 ? 1 : 0.42));
    expect(maxAbsError(raw, decompressed, 16, 16, RGBA_HALF, (c) => c !== 3)).toBeLessThan(1e-3);
  });

  it('round-trips 32-bit FLOAT RGB channels (quantized through half internally)', () => {
    const { raw, decompressed } = roundTrip(16, 16, RGBA_FLOAT, (x, y, c) =>
      c === 3 ? 1 : Math.sin(x * 0.4) * 0.5 + Math.cos(y * 0.3) * 0.3 + c * 0.05,
    );
    expect(decompressed.length).toBe(raw.length);
    expect(maxAbsError(raw, decompressed, 16, 16, RGBA_FLOAT, (c) => c !== 3)).toBeLessThan(0.003);
  });

  it('handles values above 1.0 (HDR range) through the perceptual nonlinear LUT', () => {
    const { raw, decompressed } = roundTrip(16, 16, RGBA_HALF, (x, y, c) => (c === 3 ? 1 : 1 + x * 2 + y * 3 + c * 10));
    const dvA = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const dvB = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
    // HDR range: check relative error since absolute values are large.
    let maxRelErr = 0;
    let offset = 0;
    for (let y = 0; y < 16; y++) {
      for (let c = 0; c < 4; c++) {
        for (let x = 0; x < 16; x++) {
          if (c !== 3) {
            const a = decodeFloat16(dvA.getUint16(offset, true));
            const b = decodeFloat16(dvB.getUint16(offset, true));
            maxRelErr = Math.max(maxRelErr, Math.abs(a - b) / Math.abs(a));
          }
          offset += 2;
        }
      }
    }
    expect(maxRelErr).toBeLessThan(0.01);
  });
});

describe('compressDwaBlock + decompressDwa (RLE path)', () => {
  it('round-trips the alpha channel losslessly (no DCT quantization)', () => {
    const { raw, decompressed } = roundTrip(13, 19, RGBA_HALF, (x, y, c) =>
      c === 3 ? 0.5 + 0.01 * x + 0.001 * y : Math.sin(x) * Math.cos(y),
    );
    expect(maxAbsError(raw, decompressed, 13, 19, RGBA_HALF, (c) => c === 3)).toBe(0);
  });

  it('round-trips a single alpha-only channel exactly, including long runs', () => {
    const channels: ExrChannel[] = [RGBA_HALF[3]!];
    const { raw, decompressed } = roundTrip(20, 20, channels, () => 0.75); // constant -> long RLE runs
    expect(decompressed).toEqual(raw);
  });

  it('round-trips a UINT alpha channel exactly', () => {
    const channels: ExrChannel[] = [{ ...RGBA_HALF[3]!, pixelType: 0 /* UINT */ }];
    const width = 8;
    const height = 8;
    const raw = new Uint8Array(width * height * 4);
    const dv = new DataView(raw.buffer);
    for (let i = 0; i < width * height; i++) dv.setUint32(i * 4, i * 12345, true);
    const compressed = compressDwaBlock(raw, width, height, channels);
    const decompressed = decompressDwa(compressed, width, channels, compressed.length, height);
    expect(decompressed).toEqual(raw);
  });
});

describe('compressDwaBlock + decompressDwa (UNKNOWN / zlib fallback path)', () => {
  it('round-trips a channel with a name that matches no DWA rule exactly', () => {
    const channels: ExrChannel[] = [
      { name: 'Z', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
    ];
    const { raw, decompressed } = roundTrip(10, 10, channels, (x, y) => x * 0.1 + y * 0.2);
    expect(decompressed).toEqual(raw);
  });
});

describe('compressDwaBlock + decompressDwa (single-channel DCT path, non-CSC)', () => {
  it('round-trips a lone "Y" luma channel (pLinear=0, nonlinear-encoded)', () => {
    const channels: ExrChannel[] = [
      { name: 'Y', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
    ];
    const { raw, decompressed } = roundTrip(
      16,
      16,
      channels,
      (x, y) => Math.sin(x * 0.3) * 0.5 + Math.cos(y * 0.2) * 0.3,
    );
    expect(maxAbsError(raw, decompressed, 16, 16, channels)).toBeLessThan(0.003);
  });

  it('round-trips a lone "Y" channel with pLinear=1 (stored linear, no LUT)', () => {
    const channels: ExrChannel[] = [
      { name: 'Y', pixelType: HALF, pLinear: 1, reserved: 0, xSampling: 1, ySampling: 1 },
    ];
    const { raw, decompressed } = roundTrip(
      16,
      16,
      channels,
      (x, y) => Math.sin(x * 0.3) * 0.5 + Math.cos(y * 0.2) * 0.3,
    );
    expect(maxAbsError(raw, decompressed, 16, 16, channels)).toBeLessThan(0.003);
  });

  it('does not CSC-group an R channel with no matching G/B', () => {
    const channels: ExrChannel[] = [RGBA_HALF[0]!];
    const { raw, decompressed } = roundTrip(
      16,
      16,
      channels,
      (x, y) => Math.sin(x * 0.3) * 0.5 + Math.cos(y * 0.2) * 0.3,
    );
    expect(maxAbsError(raw, decompressed, 16, 16, channels)).toBeLessThan(0.003);
  });
});

describe('compressDwaBlock chunk format', () => {
  it('writes a valid version-2 header with an empty (no-override) channel rule block', () => {
    const raw = buildRaw(8, 8, RGBA_HALF, (_x, _y, c) => (c === 3 ? 1 : 0.3));
    const compressed = compressDwaBlock(raw, 8, 8, RGBA_HALF);
    const dv = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
    const version = Number(dv.getBigUint64(0, true));
    expect(version).toBe(2);
    const ruleSize = dv.getUint16(11 * 8, true);
    expect(ruleSize).toBe(2); // no per-channel overrides: R/G/B/A all match the default rules
  });

  it('produces smaller output for smoother/more compressible data', () => {
    const flat = buildRaw(32, 32, RGBA_HALF, (_x, _y, c) => (c === 3 ? 1 : 0.5));
    const noisy = buildRaw(32, 32, RGBA_HALF, () => Math.random());
    const flatCompressed = compressDwaBlock(flat, 32, 32, RGBA_HALF);
    const noisyCompressed = compressDwaBlock(noisy, 32, 32, RGBA_HALF);
    expect(flatCompressed.length).toBeLessThan(noisyCompressed.length);
  });
});
