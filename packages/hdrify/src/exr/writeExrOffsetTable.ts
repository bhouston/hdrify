/**
 * EXR scan line offset table builder
 * Builds the offset table (one 64-bit offset per block) per OpenEXR spec.
 */

import {
  INT32_SIZE,
  NO_COMPRESSION,
  PIZ_COMPRESSION,
  PXR24_COMPRESSION,
  RLE_COMPRESSION,
  ULONG_SIZE,
  ZIP_COMPRESSION,
  ZIPS_COMPRESSION,
} from './exrConstants.js';

/** Block heights per compression type (OpenEXR spec) */
const BLOCK_HEIGHT: Record<number, number> = {
  [NO_COMPRESSION]: 1,
  [RLE_COMPRESSION]: 1,
  [ZIPS_COMPRESSION]: 1,
  [ZIP_COMPRESSION]: 16,
  [PIZ_COMPRESSION]: 32,
  [PXR24_COMPRESSION]: 16,
};

/**
 * Get the number of scan lines per block for the given compression type.
 */
export function getBlockHeight(compression: number): number {
  return BLOCK_HEIGHT[compression] ?? 1;
}

/**
 * Get the number of blocks for the given image height and compression.
 */
export function getBlockCount(height: number, compression: number): number {
  const blockHeight = getBlockHeight(compression);
  return Math.ceil(height / blockHeight);
}

export interface BuildExrOffsetTableOptions {
  width: number;
  height: number;
  compression: number;
  /** Byte offset in the file where the offset table starts */
  offsetTableStart: number;
  /** Bytes per pixel (e.g. 16 for RGBA float) */
  bytesPerPixel?: number;
}

/**
 * Compute the size in bytes of a single scan line block.
 * Block layout: y (4) + dataSize (4) + pixelData.
 */
function getBlockSize(width: number, lineCount: number, bytesPerPixel: number): number {
  const pixelDataSize = width * lineCount * bytesPerPixel;
  return INT32_SIZE + INT32_SIZE + pixelDataSize;
}

/**
 * Build the scan line offset table.
 * Returns a Uint8Array of little-endian uint64 values, one per block.
 */
export function buildExrOffsetTable(options: BuildExrOffsetTableOptions): Uint8Array {
  const {
    width,
    height,
    compression,
    offsetTableStart,
    bytesPerPixel = 16, // RGBA float
  } = options;

  const blockCount = getBlockCount(height, compression);
  const blockHeight = getBlockHeight(compression);
  const result = new Uint8Array(blockCount * ULONG_SIZE);
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

  let currentOffset = offsetTableStart + blockCount * ULONG_SIZE;

  for (let b = 0; b < blockCount; b++) {
    const firstLineY = b * blockHeight;
    const lineCount = Math.min(blockHeight, height - firstLineY);
    const blockSize = getBlockSize(width, lineCount, bytesPerPixel);

    view.setBigUint64(b * ULONG_SIZE, BigInt(currentOffset), true);
    currentOffset += blockSize;
  }

  return result;
}

export interface BuildExrOffsetTableFromBlocksOptions {
  /** Byte offset in the file where the offset table starts */
  offsetTableStart: number;
  /** Pre-built blocks (each has y + dataSize + data) */
  blocks: Uint8Array[];
}

/**
 * Build offset table from actual block data (for variable-size compressed blocks)
 */
export function buildExrOffsetTableFromBlocks(options: BuildExrOffsetTableFromBlocksOptions): Uint8Array {
  const { offsetTableStart, blocks } = options;
  const blockCount = blocks.length;
  const result = new Uint8Array(blockCount * ULONG_SIZE);
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

  let currentOffset = offsetTableStart + blockCount * ULONG_SIZE;

  for (let b = 0; b < blockCount; b++) {
    view.setBigUint64(b * ULONG_SIZE, BigInt(currentOffset), true);
    currentOffset += (blocks[b]?.length ?? 0);
  }

  return result;
}
