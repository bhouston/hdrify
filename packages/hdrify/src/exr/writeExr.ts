/**
 * EXR (OpenEXR) file writer
 *
 * Writes EXR files from HdrifyImage.
 * Orchestrates header builder, offset table, and scan block modules.
 * Supports NO_COMPRESSION, RLE, ZIP, ZIPS.
 */

import { LINEAR_TO_CHROMATICITIES } from '../color/colorSpaces.js';
import { ensureNonNegativeFinite, type HdrifyImage } from '../hdrifyImage.js';
import {
  HALF,
  PIZ_COMPRESSION,
  PXR24_COMPRESSION,
  RLE_COMPRESSION,
  ZIP_COMPRESSION,
  ZIPS_COMPRESSION,
} from './exrConstants.js';
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
  /** Compression: 0=none, 1=RLE, 2=ZIPS, 3=ZIP, 4=PIZ, 5=PXR24 */
  compression?: number;
}

function getChannelsForCompression(compression: number): ExrChannel[] {
  const base = [...DEFAULT_CHANNELS];
  if (
    compression === RLE_COMPRESSION ||
    compression === ZIP_COMPRESSION ||
    compression === ZIPS_COMPRESSION ||
    compression === PIZ_COMPRESSION ||
    compression === PXR24_COMPRESSION
  ) {
    return base.map((ch) => ({ ...ch, pixelType: HALF }));
  }
  return base;
}

/**
 * Write an EXR file buffer from HdrifyImage
 *
 * @param HdrifyImage - HdrifyImage containing image dimensions and pixel data
 * @param options - Optional compression (default: zip; use piz for broader compatibility)
 * @returns Uint8Array containing EXR file data
 */
export function writeExr(hdrifyImage: HdrifyImage, options?: WriteExrOptions): Uint8Array {
  ensureNonNegativeFinite(hdrifyImage.data);
  const { width, height } = hdrifyImage;
  const compression = options?.compression ?? ZIP_COMPRESSION;
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

  const useCompression =
    compression === RLE_COMPRESSION ||
    compression === ZIP_COMPRESSION ||
    compression === ZIPS_COMPRESSION ||
    compression === PIZ_COMPRESSION ||
    compression === PXR24_COMPRESSION;
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
