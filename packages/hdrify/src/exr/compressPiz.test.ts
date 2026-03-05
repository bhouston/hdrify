import { describe, expect, it } from 'vitest';
import { applyLutForward, bitmapFromData, compressPizBlock, forwardLutFromBitmap } from './compressPiz.js';
import { decompressPiz } from './decompressPiz.js';
import { BITMAP_SIZE, FLOAT, FLOAT32_SIZE, HALF, INT16_SIZE, USHORT_RANGE } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';

/** Channels with HALF (16-bit) pixel type for PIZ round-trips; our encoder outputs 16-bit PIZ. */
const HALF_CHANNELS: ExrChannel[] = [
  { name: 'R', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'G', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'B', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'A', pixelType: HALF, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
];

/** Channels with FLOAT (32-bit) pixel type for 32-bit PIZ round-trips. */
const FLOAT_CHANNELS: ExrChannel[] = [
  { name: 'R', pixelType: FLOAT, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'G', pixelType: FLOAT, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'B', pixelType: FLOAT, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'A', pixelType: FLOAT, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
];

describe('bitmapFromData', () => {
  it('sets bitmap bits for values present', () => {
    const data = new Uint16Array([0, 1, 2, 100, 1000]);
    const bitmap = new Uint8Array(BITMAP_SIZE);
    const minNonZero = { value: 0 };
    const maxNonZero = { value: 0 };
    bitmapFromData(data, 5, bitmap, minNonZero, maxNonZero);
    expect((bitmap[0] ?? 0) & 1).toBe(0);
    expect((bitmap[0] ?? 0) & 2).toBe(2);
    expect((bitmap[0] ?? 0) & 4).toBe(4);
    expect((bitmap[12] ?? 0) & 16).toBe(16);
    expect(minNonZero.value).toBeLessThanOrEqual(maxNonZero.value);
  });

  it('handles all-zero data', () => {
    const data = new Uint16Array([0, 0, 0]);
    const bitmap = new Uint8Array(BITMAP_SIZE);
    const minNonZero = { value: 0 };
    const maxNonZero = { value: 0 };
    bitmapFromData(data, 3, bitmap, minNonZero, maxNonZero);
    expect((bitmap[0] ?? 0) & 1).toBe(0);
  });
});

describe('forwardLutFromBitmap and applyLutForward', () => {
  it('round-trips with reverse LUT logic', () => {
    const bitmap = new Uint8Array(BITMAP_SIZE);
    bitmap[0] = 0x06;
    bitmap[1] = 0x01;
    const lut = new Uint16Array(USHORT_RANGE);
    const maxValue = forwardLutFromBitmap(bitmap, lut);
    expect(maxValue).toBeGreaterThanOrEqual(0);

    const data = new Uint16Array([0, 1, 2, 8]);
    const nData = 4;
    applyLutForward(lut, data, nData);
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(1);
    expect(data[2]).toBe(2);
  });
});

describe('compressPizBlock + decompressPiz', () => {
  it('round-trips half-float block', () => {
    const width = 8;
    const blockHeight = 8;
    const numChannels = 4;
    const interleaved = new Uint8Array(width * blockHeight * numChannels * 2);
    const view = new DataView(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);
    for (let i = 0; i < width * blockHeight * numChannels; i++) {
      view.setUint16(i * 2, (i * 3) & 0xffff, true);
    }

    const compressed = compressPizBlock(interleaved, width, blockHeight, HALF_CHANNELS);
    expect(compressed.length).toBeGreaterThan(0);

    const decompressed = decompressPiz(compressed, width, HALF_CHANNELS, compressed.length, blockHeight);
    expect(decompressed.length).toBe(interleaved.length);
    expect(decompressed).toEqual(interleaved);
  });

  it('round-trips uniform block', () => {
    const width = 4;
    const blockHeight = 4;
    const interleaved = new Uint8Array(width * blockHeight * 4 * 2);
    const view = new DataView(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);
    const half = 0x3c00;
    for (let i = 0; i < width * blockHeight * 4; i++) {
      view.setUint16(i * 2, half, true);
    }

    const compressed = compressPizBlock(interleaved, width, blockHeight, HALF_CHANNELS);
    const decompressed = decompressPiz(compressed, width, HALF_CHANNELS, compressed.length, blockHeight);
    expect(decompressed).toEqual(interleaved);
  });

  it('round-trips block with partial height', () => {
    const width = 8;
    const blockHeight = 16;
    const interleaved = new Uint8Array(width * blockHeight * 4 * 2);
    for (let i = 0; i < interleaved.length; i++) {
      interleaved[i] = (i + 1) & 0xff;
    }

    const compressed = compressPizBlock(interleaved, width, blockHeight, HALF_CHANNELS);
    const decompressed = decompressPiz(compressed, width, HALF_CHANNELS, compressed.length, blockHeight);
    expect(decompressed).toEqual(interleaved);
  });
});

describe('PIZ encoder (fine-grained)', () => {
  it('compressPizBlock 16-bit produces valid PIZ header (minNonZero, maxNonZero in range)', () => {
    const width = 4;
    const blockHeight = 4;
    const interleaved = new Uint8Array(width * blockHeight * 4 * INT16_SIZE);
    const view = new DataView(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);
    for (let i = 0; i < width * blockHeight * 4; i++) {
      view.setUint16(i * 2, i & 0xffff, true);
    }
    const compressed = compressPizBlock(interleaved, width, blockHeight, HALF_CHANNELS);
    expect(compressed.length).toBeGreaterThanOrEqual(8);
    const dataView = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
    const minVal = dataView.getUint16(0, true);
    const maxVal = dataView.getUint16(2, true);
    expect(minVal).toBeLessThan(BITMAP_SIZE);
    expect(maxVal).toBeLessThan(BITMAP_SIZE);
    expect(minVal).toBeLessThanOrEqual(maxVal);
  });

  it('compressPizBlock 32-bit produces valid PIZ header', () => {
    const width = 4;
    const blockHeight = 4;
    const interleaved = new Uint8Array(width * blockHeight * 4 * FLOAT32_SIZE);
    const view = new DataView(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);
    for (let i = 0; i < width * blockHeight * 4; i++) {
      view.setFloat32(i * 4, 0.5, true);
    }
    const compressed = compressPizBlock(interleaved, width, blockHeight, FLOAT_CHANNELS);
    expect(compressed.length).toBeGreaterThanOrEqual(8);
    const dataView = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
    const minVal = dataView.getUint16(0, true);
    const maxVal = dataView.getUint16(2, true);
    expect(minVal).toBeLessThan(BITMAP_SIZE);
    expect(maxVal).toBeLessThan(BITMAP_SIZE);
  });
});

describe('PIZ decoder (fine-grained)', () => {
  it('decompressPiz 16-bit returns correct byte length', () => {
    const width = 4;
    const blockHeight = 4;
    const numChannels = 4;
    const interleaved = new Uint8Array(width * blockHeight * numChannels * INT16_SIZE);
    const compressed = compressPizBlock(interleaved, width, blockHeight, HALF_CHANNELS);
    const decompressed = decompressPiz(compressed, width, HALF_CHANNELS, compressed.length, blockHeight);
    const expectedBytes = width * blockHeight * numChannels * INT16_SIZE;
    expect(decompressed.length).toBe(expectedBytes);
  });

  it('decompressPiz 32-bit returns correct byte length', () => {
    const width = 4;
    const blockHeight = 4;
    const numChannels = 4;
    const interleaved = new Uint8Array(width * blockHeight * numChannels * FLOAT32_SIZE);
    const view = new DataView(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);
    for (let i = 0; i < width * blockHeight * numChannels; i++) {
      view.setFloat32(i * 4, 0.25, true);
    }
    const compressed = compressPizBlock(interleaved, width, blockHeight, FLOAT_CHANNELS);
    const decompressed = decompressPiz(compressed, width, FLOAT_CHANNELS, compressed.length, blockHeight);
    const expectedBytes = width * blockHeight * numChannels * FLOAT32_SIZE;
    expect(decompressed.length).toBe(expectedBytes);
  });
});

describe('compressPizBlock + decompressPiz (32-bit float)', () => {
  it('round-trips 32-bit float block', () => {
    const width = 8;
    const blockHeight = 8;
    const numChannels = 4;
    const interleaved = new Uint8Array(width * blockHeight * numChannels * FLOAT32_SIZE);
    const view = new DataView(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);
    for (let i = 0; i < width * blockHeight * numChannels; i++) {
      view.setFloat32(i * 4, (i * 0.001) % 1, true);
    }
    const compressed = compressPizBlock(interleaved, width, blockHeight, FLOAT_CHANNELS);
    expect(compressed.length).toBeGreaterThan(0);
    const decompressed = decompressPiz(compressed, width, FLOAT_CHANNELS, compressed.length, blockHeight);
    expect(decompressed.length).toBe(interleaved.length);
    const outView = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
    for (let i = 0; i < width * blockHeight * numChannels; i++) {
      const expected = view.getFloat32(i * 4, true);
      const actual = outView.getFloat32(i * 4, true);
      expect(actual).toBeCloseTo(expected, 5);
    }
  });
});
