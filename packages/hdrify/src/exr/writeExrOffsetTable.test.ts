/**
 * EXR offset table builder tests
 */

import { describe, expect, it } from 'vitest';
import {
  buildExrOffsetTable,
  getBlockCount,
  getBlockHeight,
} from './writeExrOffsetTable.js';
import {
  NO_COMPRESSION,
  PIZ_COMPRESSION,
  RLE_COMPRESSION,
  ULONG_SIZE,
  ZIP_COMPRESSION,
  ZIPS_COMPRESSION,
} from './exrConstants.js';

describe('getBlockHeight', () => {
  it('returns 1 for NO_COMPRESSION', () => {
    expect(getBlockHeight(NO_COMPRESSION)).toBe(1);
  });

  it('returns 1 for RLE_COMPRESSION', () => {
    expect(getBlockHeight(RLE_COMPRESSION)).toBe(1);
  });

  it('returns 1 for ZIPS_COMPRESSION', () => {
    expect(getBlockHeight(ZIPS_COMPRESSION)).toBe(1);
  });

  it('returns 16 for ZIP_COMPRESSION', () => {
    expect(getBlockHeight(ZIP_COMPRESSION)).toBe(16);
  });

  it('returns 32 for PIZ_COMPRESSION', () => {
    expect(getBlockHeight(PIZ_COMPRESSION)).toBe(32);
  });
});

describe('getBlockCount', () => {
  it('returns height for NO_COMPRESSION (1 block per line)', () => {
    expect(getBlockCount(10, NO_COMPRESSION)).toBe(10);
    expect(getBlockCount(1, NO_COMPRESSION)).toBe(1);
  });

  it('returns ceil(height/16) for ZIP_COMPRESSION', () => {
    expect(getBlockCount(16, ZIP_COMPRESSION)).toBe(1);
    expect(getBlockCount(17, ZIP_COMPRESSION)).toBe(2);
    expect(getBlockCount(32, ZIP_COMPRESSION)).toBe(2);
  });

  it('returns ceil(height/32) for PIZ_COMPRESSION', () => {
    expect(getBlockCount(32, PIZ_COMPRESSION)).toBe(1);
    expect(getBlockCount(33, PIZ_COMPRESSION)).toBe(2);
    expect(getBlockCount(64, PIZ_COMPRESSION)).toBe(2);
  });
});

describe('buildExrOffsetTable', () => {
  it('produces correct size for NO_COMPRESSION 10x10', () => {
    const table = buildExrOffsetTable({
      width: 10,
      height: 10,
      compression: NO_COMPRESSION,
      offsetTableStart: 100,
    });
    expect(table.length).toBe(10 * ULONG_SIZE);
  });

  it('produces correct size for ZIP 32x32', () => {
    const table = buildExrOffsetTable({
      width: 32,
      height: 32,
      compression: ZIP_COMPRESSION,
      offsetTableStart: 200,
    });
    expect(table.length).toBe(2 * ULONG_SIZE); // ceil(32/16) = 2 blocks
  });

  it('first offset points after offset table', () => {
    const offsetTableStart = 200;
    const table = buildExrOffsetTable({
      width: 2,
      height: 2,
      compression: NO_COMPRESSION,
      offsetTableStart,
    });
    const firstOffset = Number(new DataView(table.buffer, table.byteOffset, 8).getBigUint64(0, true));
    expect(firstOffset).toBe(offsetTableStart + 2 * ULONG_SIZE);
  });

  it('offsets increase by block size', () => {
    const width = 4;
    const height = 2;
    const offsetTableStart = 100;
    const table = buildExrOffsetTable({
      width,
      height,
      compression: NO_COMPRESSION,
      offsetTableStart,
    });
    const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
    const offset0 = Number(view.getBigUint64(0, true));
    const offset1 = Number(view.getBigUint64(8, true));
    const blockSize = 4 + 4 + width * 16; // y + dataSize + pixels
    expect(offset1 - offset0).toBe(blockSize);
  });
});
