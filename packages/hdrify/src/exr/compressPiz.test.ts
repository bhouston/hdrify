import { describe, expect, it } from 'vitest';
import { applyLutForward, bitmapFromData, compressPizBlock, forwardLutFromBitmap } from './compressPiz.js';
import { decompressPiz } from './decompressPiz.js';
import { BITMAP_SIZE, USHORT_RANGE } from './exrConstants.js';
import { DEFAULT_CHANNELS } from './exrHeaderBuilder.js';

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

    const compressed = compressPizBlock(interleaved, width, blockHeight, DEFAULT_CHANNELS);
    expect(compressed.length).toBeGreaterThan(0);

    const decompressed = decompressPiz(compressed, width, DEFAULT_CHANNELS, compressed.length, blockHeight);
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

    const compressed = compressPizBlock(interleaved, width, blockHeight, DEFAULT_CHANNELS);
    const decompressed = decompressPiz(compressed, width, DEFAULT_CHANNELS, compressed.length, blockHeight);
    expect(decompressed).toEqual(interleaved);
  });

  it('round-trips block with partial height', () => {
    const width = 8;
    const blockHeight = 16;
    const interleaved = new Uint8Array(width * blockHeight * 4 * 2);
    for (let i = 0; i < interleaved.length; i++) {
      interleaved[i] = (i + 1) & 0xff;
    }

    const compressed = compressPizBlock(interleaved, width, blockHeight, DEFAULT_CHANNELS);
    const decompressed = decompressPiz(compressed, width, DEFAULT_CHANNELS, compressed.length, blockHeight);
    expect(decompressed).toEqual(interleaved);
  });
});
