/**
 * EXR scan block writer tests
 */

import { describe, expect, it } from 'vitest';
import type { FloatImageData } from '../floatImage.js';
import { FLOAT32_SIZE, NO_COMPRESSION } from './exrConstants.js';
import { DEFAULT_CHANNELS } from './exrHeaderBuilder.js';
import { writeExrScanBlock } from './writeExrScanBlock.js';

function createTestImage(width: number, height: number): FloatImageData {
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = i / (width * height); // R
    data[i * 4 + 1] = 0.5; // G
    data[i * 4 + 2] = 0.75; // B
    data[i * 4 + 3] = 1.0; // A
  }
  return { width, height, data };
}

describe('writeExrScanBlock', () => {
  it('produces correct block layout for 1x1 image', () => {
    const img = createTestImage(1, 1);
    const block = writeExrScanBlock({
      floatImageData: img,
      firstLineY: 0,
      lineCount: 1,
      compression: NO_COMPRESSION,
      channels: DEFAULT_CHANNELS,
    });

    expect(block.length).toBe(8 + 1 * 4 * FLOAT32_SIZE); // y + size + 1 pixel RGBA
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    expect(view.getInt32(0, true)).toBe(0);
    expect(view.getUint32(4, true)).toBe(16);
    expect(view.getFloat32(8, true)).toBeCloseTo(0);
    expect(view.getFloat32(12, true)).toBe(0.5);
    expect(view.getFloat32(16, true)).toBe(0.75);
    expect(view.getFloat32(20, true)).toBe(1.0);
  });

  it('produces correct block layout for 2x2 image, first line', () => {
    const img = createTestImage(2, 2);
    const block = writeExrScanBlock({
      floatImageData: img,
      firstLineY: 0,
      lineCount: 1,
      compression: NO_COMPRESSION,
      channels: DEFAULT_CHANNELS,
    });

    expect(block.length).toBe(8 + 2 * 4 * FLOAT32_SIZE);
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    expect(view.getInt32(0, true)).toBe(0);
    expect(view.getUint32(4, true)).toBe(2 * 16);

    // Pixel (0,0): R=0, G=0.5, B=0.75, A=1
    expect(view.getFloat32(8, true)).toBeCloseTo(0);
    expect(view.getFloat32(12, true)).toBe(0.5);
    expect(view.getFloat32(16, true)).toBe(0.75);
    expect(view.getFloat32(20, true)).toBe(1.0);

    // Pixel (1,0): R=0.25, G=0.5, B=0.75, A=1
    expect(view.getFloat32(24, true)).toBeCloseTo(0.25);
    expect(view.getFloat32(28, true)).toBe(0.5);
    expect(view.getFloat32(32, true)).toBe(0.75);
    expect(view.getFloat32(36, true)).toBe(1.0);
  });

  it('produces correct block for second scan line', () => {
    const img = createTestImage(2, 2);
    const block = writeExrScanBlock({
      floatImageData: img,
      firstLineY: 1,
      lineCount: 1,
      compression: NO_COMPRESSION,
      channels: DEFAULT_CHANNELS,
    });

    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    expect(view.getInt32(0, true)).toBe(1);
    // Pixel (0,1): R=0.5, G=0.5, B=0.75, A=1
    expect(view.getFloat32(8, true)).toBeCloseTo(0.5);
  });

  it('throws on unsupported compression', () => {
    const img = createTestImage(1, 1);
    expect(() =>
      writeExrScanBlock({
        floatImageData: img,
        firstLineY: 0,
        lineCount: 1,
        compression: 6, // B44 - not implemented
        channels: DEFAULT_CHANNELS,
      }),
    ).toThrow('not implemented');
  });
});
