/**
 * EXR (OpenEXR) file writer
 *
 * Writes EXR files from FloatImageData.
 * Orchestrates header builder, offset table, and scan block modules.
 * Supports uncompressed (NO_COMPRESSION) only; PIZ/ZIP/RLE can be added later.
 */

import type { FloatImageData } from '../floatImage.js';
import { buildExrHeader, buildMagicAndVersion, DEFAULT_CHANNELS } from './exrHeaderBuilder.js';
import { buildExrOffsetTable, getBlockCount, getBlockHeight } from './writeExrOffsetTable.js';
import { writeExrScanBlock } from './writeExrScanBlock.js';
import { concatUint8Arrays } from './exrUtils.js';
import { NO_COMPRESSION, ULONG_SIZE } from './exrConstants.js';

/**
 * Write an EXR file buffer from FloatImageData
 *
 * @param floatImageData - FloatImageData containing image dimensions and pixel data
 * @returns Uint8Array containing EXR file data
 */
export function writeExr(floatImageData: FloatImageData): Uint8Array {
  const { width, height } = floatImageData;
  const compression = NO_COMPRESSION;
  const channels = DEFAULT_CHANNELS;

  const magicVersion = buildMagicAndVersion();
  const header = buildExrHeader({ width, height, compression, channels });
  const headerEnd = magicVersion.length + header.length;

  const offsetTableStart = headerEnd;
  const blockCount = getBlockCount(height, compression);
  const offsetTable = buildExrOffsetTable({
    width,
    height,
    compression,
    offsetTableStart,
  });

  const blocks: Uint8Array[] = [];
  const blockHeight = getBlockHeight(compression);

  for (let b = 0; b < blockCount; b++) {
    const firstY = b * blockHeight;
    const lineCount = Math.min(blockHeight, height - firstY);
    const block = writeExrScanBlock({
      floatImageData,
      firstLineY: firstY,
      lineCount,
      compression,
      channels,
    });
    blocks.push(block);
  }

  return concatUint8Arrays([magicVersion, header, offsetTable, ...blocks]);
}
