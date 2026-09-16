/**
 * EXR (OpenEXR) file writer
 *
 * Writes EXR files from HdrifyImage.
 * Orchestrates header builder, offset table, and scan block modules.
 * Supports every codec in EXR_COMPRESSION_CODES.
 */

import { LINEAR_TO_CHROMATICITIES } from '../color/colorSpaces.js';
import { ensureNonNegativeFinite, type HdrifyImage } from '../hdrifyImage.js';
import { EXR_COMPRESSION_CODES, type ExrCompression, HALF, NO_COMPRESSION, ZIP_COMPRESSION } from './exrConstants.js';
import { buildExrHeader, buildMagicAndVersion, DEFAULT_CHANNELS } from './exrHeaderBuilder.js';
import type { ExrChannel } from './exrTypes.js';
import { concatUint8Arrays } from './exrUtils.js';
import {
  buildExrOffsetTable,
  buildExrOffsetTableFromBlocks,
  getBlockCount,
  getBlockHeight,
} from './writeExrOffsetTable.js';
import { writeExrScanBlock } from './writeExrScanBlock.js';

export interface WriteExrOptions {
  /** Compression name (see EXR_COMPRESSIONS) or OpenEXR compression code. Default: zip. */
  compression?: ExrCompression | number;
  /** Replace negative and non-finite values with 0 before writing (default true). Set false for normal, depth or disparity data. */
  sanitize?: boolean;
}

function getChannelsForCompression(compression: number): ExrChannel[] {
  // All compressed codecs write HALF; uncompressed keeps the default (FLOAT) channels
  return compression === NO_COMPRESSION
    ? [...DEFAULT_CHANNELS]
    : DEFAULT_CHANNELS.map((ch) => ({ ...ch, pixelType: HALF }));
}

/**
 * Write an EXR file buffer from HdrifyImage
 *
 * @param HdrifyImage - HdrifyImage containing image dimensions and pixel data
 * @param options - Optional compression (default: zip; use piz for broader compatibility)
 * @returns Uint8Array containing EXR file data
 */
export function writeExr(hdrifyImage: HdrifyImage, options?: WriteExrOptions): Uint8Array {
  if (options?.sanitize !== false) ensureNonNegativeFinite(hdrifyImage.data);
  const { width, height } = hdrifyImage;
  const c = options?.compression ?? ZIP_COMPRESSION;
  const compression = typeof c === 'string' ? EXR_COMPRESSION_CODES[c] : c;
  const channels = getChannelsForCompression(compression);
  // OpenEXR requires channels to be sorted alphabetically
  channels.sort((a, b) => a.name.localeCompare(b.name));

  const chromaticities = LINEAR_TO_CHROMATICITIES[hdrifyImage.linearColorSpace];
  const magicVersion = buildMagicAndVersion();
  const header = buildExrHeader({ width, height, compression, channels, chromaticities });
  const headerEnd = magicVersion.length + header.length;
  const offsetTableStart = headerEnd;
  const blockCount = getBlockCount(height, compression);
  const blockHeight = getBlockHeight(compression);

  const blocks: Uint8Array[] = [];
  for (let b = 0; b < blockCount; b++) {
    const firstY = b * blockHeight;
    const lineCount = Math.min(blockHeight, height - firstY);
    const block = writeExrScanBlock({
      hdrifyImage,
      firstLineY: firstY,
      lineCount,
      compression,
      channels,
    });
    blocks.push(block);
  }

  const useCompression = compression !== NO_COMPRESSION;
  const offsetTable = useCompression
    ? buildExrOffsetTableFromBlocks({ offsetTableStart, blocks })
    : buildExrOffsetTable({
        width,
        height,
        compression,
        offsetTableStart,
      });

  return concatUint8Arrays([magicVersion, header, offsetTable, ...blocks]);
}
