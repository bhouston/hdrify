/**
 * EXR (OpenEXR) file reader
 *
 * Extracted and adapted from Three.js EXRLoader
 * Supports PIZ, ZIP, RLE, and uncompressed EXR files
 */

import { chromaticitiesToLinearColorSpace } from '../color/colorSpaces.js';
import type { HdrifyImage } from '../hdrifyImage.js';
import { decompressB44 } from './decompressB44.js';
import { decompressDwa } from './decompressDwa.js';
import { decompressPiz } from './decompressPiz.js';
import { decompressPxr24 } from './decompressPxr24.js';
import { decompressRleBlock } from './decompressRle.js';
import { decompressZip } from './decompressZip.js';
import { getChannelSemanticName } from './exrChannelSemantics.js';
import {
  B44A_COMPRESSION,
  B44_COMPRESSION,
  DWAA_COMPRESSION,
  DWAB_COMPRESSION,
  FLOAT,
  FLOAT32_SIZE,
  HALF,
  INT16_SIZE,
  INT32_SIZE,
  NO_COMPRESSION,
  PIZ_COMPRESSION,
  PXR24_COMPRESSION,
  RLE_COMPRESSION,
  UINT,
  ULONG_SIZE,
  ZIP_COMPRESSION,
  ZIPS_COMPRESSION,
} from './exrConstants.js';
import { parseExrHeader } from './exrHeader.js';
import { getHalfToFloatLut } from './halfFloat.js';

function getPixelTypeSize(pixelType: number): number {
  switch (pixelType) {
    case UINT:
      return INT32_SIZE;
    case HALF:
      return INT16_SIZE;
    case FLOAT:
      return FLOAT32_SIZE;
    default:
      throw new Error(`Unknown pixel type: ${pixelType}`);
  }
}

/**
 * Read an EXR file buffer and return HdrifyImage
 *
 * @param exrBuffer - Uint8Array containing EXR file data
 * @returns Parsed EXR image data with dimensions and pixel data as HdrifyImage
 */
export interface ReadExrOptions {
  /** Replace negative and non-finite values with 0 after reading (default true). Set false for normal, depth or disparity data. */
  sanitize?: boolean;
}

export function readExr(exrBuffer: Uint8Array, options?: ReadExrOptions): HdrifyImage {
  const dataView = new DataView(exrBuffer.buffer, exrBuffer.byteOffset, exrBuffer.byteLength);
  const { header: parsedHeader, offset } = parseExrHeader(exrBuffer);

  const { header, dataWindow, channels, compression } = parsedHeader;
  const width = dataWindow.xMax - dataWindow.xMin + 1;
  const height = dataWindow.yMax - dataWindow.yMin + 1;

  // Resolve channel semantics for mode detection
  const hasR = channels.some((ch) => getChannelSemanticName(ch.name) === 'r');
  const hasG = channels.some((ch) => getChannelSemanticName(ch.name) === 'g');
  const hasB = channels.some((ch) => getChannelSemanticName(ch.name) === 'b');
  const hasLuma = channels.some((ch) => getChannelSemanticName(ch.name) === 'luma');

  const isRgbMode = hasR && hasG && hasB;
  const isLumaMode = !isRgbMode && hasLuma;

  if (!isRgbMode && !isLumaMode) {
    throw new Error(
      'Non-RGB EXR files are not supported. This reader requires R, G, and B channels, or a luminance (Y/L/luma) channel.',
    );
  }

  // Determine block height based on compression type (OpenEXR spec: ZIP/PXR24=16, PIZ=32, others=1)
  const blockHeight =
    compression === PIZ_COMPRESSION ||
    compression === DWAA_COMPRESSION ||
    compression === B44_COMPRESSION ||
    compression === B44A_COMPRESSION
      ? 32
      : compression === ZIP_COMPRESSION || compression === PXR24_COMPRESSION
        ? 16
        : compression === DWAB_COMPRESSION
          ? 256
          : 1;
  const expectedBlockCount = Math.ceil(height / blockHeight);

  // Read scanline offsets - exactly one offset per block
  const scanlineBlockOffsets: number[] = [];
  const offsetTableStart = offset;
  let readOffset = offset;

  const maxOffsets = expectedBlockCount;
  for (let i = 0; i < maxOffsets && readOffset + ULONG_SIZE <= exrBuffer.length; i++) {
    // Read as uint64, but handle case where value might be stored incorrectly
    let offsetValue = Number(dataView.getBigUint64(readOffset, true));

    // If the value is way too large (likely a byte-order issue), try reading as two uint32s
    if (offsetValue > exrBuffer.length && offsetValue < Number.MAX_SAFE_INTEGER) {
      const low32 = dataView.getUint32(readOffset, true);
      const high32 = dataView.getUint32(readOffset + 4, true);
      if (high32 === 0 && low32 < exrBuffer.length) {
        offsetValue = low32;
      } else if (low32 === 0 && high32 < exrBuffer.length) {
        offsetValue = high32;
      }
    }

    const canReadBlockHeader = offsetValue >= 0 && offsetValue + 8 <= exrBuffer.length;
    const notInHeader = offsetValue >= offsetTableStart;
    if (canReadBlockHeader && notInHeader) {
      scanlineBlockOffsets.push(offsetValue);
    } else if (scanlineBlockOffsets.length > 0) {
      break;
    }
    readOffset += ULONG_SIZE;
  }

  // Determine actual block height by checking Y coordinates of first two scanlines
  let actualBlockHeightFinal = blockHeight;
  if (scanlineBlockOffsets.length >= 2) {
    const firstOffset = scanlineBlockOffsets[0];
    const secondOffset = scanlineBlockOffsets[1];

    if (
      firstOffset !== undefined &&
      secondOffset !== undefined &&
      firstOffset < exrBuffer.length &&
      secondOffset < exrBuffer.length &&
      firstOffset >= 0 &&
      secondOffset >= 0
    ) {
      try {
        const firstY = dataView.getInt32(firstOffset, true);
        const secondY = dataView.getInt32(secondOffset, true);

        if (secondY === firstY + 1) {
          actualBlockHeightFinal = 1;
          if (scanlineBlockOffsets.length > height) {
            scanlineBlockOffsets.length = height;
          }
        }
      } catch {
        // If we can't read Y coordinates, use default block height
      }
    }
  }

  const blockCount = scanlineBlockOffsets.length;

  if (blockCount === 0) {
    throw new Error(`Invalid EXR file: no valid scanline block offsets found`);
  }
  const pixelData = new Float32Array(width * height * 4); // RGBA

  // Every decoded block (and an uncompressed one) is channel-planar per scanline:
  // for each line, for each channel in header order, `width` samples of that channel's type.
  // Resolve each channel's output slot (0..3, or -1 to skip) once, not per sample.
  const channelSizes = channels.map((ch) => getPixelTypeSize(ch.pixelType));
  const channelLineOffsets: number[] = [];
  const channelSlots: number[] = [];
  let bytesPerScanline = 0;
  let hasAlpha = false;
  for (let c = 0; c < channels.length; c++) {
    const sem = getChannelSemanticName(channels[c]!.name);
    const slot = isRgbMode ? { r: 0, g: 1, b: 2, a: 3 }[sem] : sem === 'luma' ? 0 : sem === 'a' ? 3 : undefined;
    channelSlots.push(slot ?? -1);
    if (slot === 3) hasAlpha = true;
    channelLineOffsets.push(bytesPerScanline);
    bytesPerScanline += width * channelSizes[c]!;
  }
  if (!hasAlpha) {
    for (let i = 3; i < pixelData.length; i += 4) pixelData[i] = 1;
  }
  const sanitize = options?.sanitize !== false;
  const halfLut = getHalfToFloatLut();

  for (let blockIdx = 0; blockIdx < blockCount; blockIdx++) {
    const scanlineBlockOffset = scanlineBlockOffsets[blockIdx];
    if (scanlineBlockOffset === undefined) {
      throw new Error(`Missing scanline block offset for block ${blockIdx}`);
    }

    if (scanlineBlockOffset >= exrBuffer.length || scanlineBlockOffset < 0) {
      throw new Error(
        `Invalid scanline block offset ${scanlineBlockOffset} for block ${blockIdx} (file size: ${exrBuffer.length})`,
      );
    }

    let scanlinePos = scanlineBlockOffset;

    if (scanlinePos + INT32_SIZE > exrBuffer.length) {
      throw new Error(`Invalid scanline block: not enough data for Y coordinate at offset ${scanlinePos}`);
    }
    const firstLineY = dataView.getInt32(scanlinePos, true);
    scanlinePos += INT32_SIZE;

    if (scanlinePos + INT32_SIZE > exrBuffer.length) {
      throw new Error(`Invalid scanline block: not enough data for data size at offset ${scanlinePos}`);
    }
    const dataSize = dataView.getUint32(scanlinePos, true);
    scanlinePos += INT32_SIZE;

    const available = exrBuffer.length - scanlinePos;
    if (dataSize <= 0 || dataSize > available) {
      const looksLikeFormatMismatch = dataSize > exrBuffer.length || dataSize > 100 * 1024 * 1024;
      if (looksLikeFormatMismatch) {
        throw new Error(
          `Unsupported or invalid EXR format: scanline block ${blockIdx} has invalid data size (${dataSize} bytes, ${available} available). ` +
            `This file may use a compression or layout not supported by this reader. Supported: none, RLE, ZIPS, ZIP, PIZ, PXR24, B44, B44A, DWAA, DWAB.`,
        );
      }
      throw new Error(
        `Invalid scanline block data size: ${dataSize} at offset ${scanlinePos - 4} (file size: ${exrBuffer.length}, available: ${available})`,
      );
    }

    const linesInBlock = Math.min(actualBlockHeightFinal, height - firstLineY);

    const expectedUncompressedSize = linesInBlock * bytesPerScanline;
    const compressedData = new Uint8Array(exrBuffer.buffer, exrBuffer.byteOffset + scanlinePos, dataSize);

    let decompressedData: Uint8Array;
    if (compression === NO_COMPRESSION || dataSize === expectedUncompressedSize) {
      // OpenEXR stores a chunk raw (any codec) when compressing it would not make it smaller.
      decompressedData = compressedData;
    } else if (compression === ZIP_COMPRESSION || compression === ZIPS_COMPRESSION) {
      decompressedData = decompressZip(compressedData);
    } else if (compression === RLE_COMPRESSION) {
      decompressedData = decompressRleBlock(compressedData, expectedUncompressedSize);
    } else if (compression === PIZ_COMPRESSION) {
      // Decoders must use this chunk's exact line count (the last chunk may be shorter than the block size).
      decompressedData = decompressPiz(compressedData, width, channels, dataSize, linesInBlock);
    } else if (compression === PXR24_COMPRESSION) {
      decompressedData = decompressPxr24(compressedData, width, channels, dataSize, linesInBlock);
    } else if (compression === DWAA_COMPRESSION || compression === DWAB_COMPRESSION) {
      decompressedData = decompressDwa(compressedData, width, channels, dataSize, linesInBlock);
    } else if (compression === B44_COMPRESSION || compression === B44A_COMPRESSION) {
      decompressedData = decompressB44(compressedData, width, channels, dataSize, linesInBlock);
    } else {
      throw new Error(`Unsupported compression type: ${compression}`);
    }

    // Typed-array row views need an aligned base; only raw-stored chunks (subarrays of the file) can be misaligned.
    if (decompressedData.byteOffset & 3) decompressedData = decompressedData.slice();
    const blockBuffer = decompressedData.buffer;
    const blockBase = decompressedData.byteOffset;

    for (let lineInBlock = 0; lineInBlock < linesInBlock; lineInBlock++) {
      const y = firstLineY + lineInBlock;
      if (y >= height) {
        break;
      }
      const rowBase = blockBase + lineInBlock * bytesPerScanline;
      const outLine = y * width * 4;

      for (let c = 0; c < channels.length; c++) {
        const slot = channelSlots[c]!;
        if (slot < 0) continue;
        const rowOffset = rowBase + channelLineOffsets[c]!;
        const pixelType = channels[c]!.pixelType;
        let row: Uint16Array | Uint32Array | Float32Array;
        if (pixelType === HALF) row = new Uint16Array(blockBuffer, rowOffset, width);
        else if (pixelType === FLOAT) row = new Float32Array(blockBuffer, rowOffset, width);
        else row = new Uint32Array(blockBuffer, rowOffset, width);

        let o = outLine + slot;
        if (pixelType === HALF) {
          for (let x = 0; x < width; x++, o += 4) {
            const v = halfLut[row[x]!]!;
            pixelData[o] = sanitize && !(v >= 0 && v < Infinity) ? 0 : v;
          }
        } else {
          for (let x = 0; x < width; x++, o += 4) {
            const v = row[x]!;
            pixelData[o] = sanitize && !(v >= 0 && v < Infinity) ? 0 : v;
          }
        }
        if (isLumaMode && slot === 0) {
          for (let x = 0, p = outLine; x < width; x++, p += 4) {
            pixelData[p + 1] = pixelData[p]!;
            pixelData[p + 2] = pixelData[p]!;
          }
        }
      }
    }
  }

  const chromaticities = header.chromaticities as
    | {
        redX: number;
        redY: number;
        greenX: number;
        greenY: number;
        blueX: number;
        blueY: number;
        whiteX: number;
        whiteY: number;
      }
    | undefined;
  const linearColorSpace =
    chromaticities &&
    typeof chromaticities.redX === 'number' &&
    typeof chromaticities.redY === 'number' &&
    typeof chromaticities.greenX === 'number' &&
    typeof chromaticities.greenY === 'number' &&
    typeof chromaticities.blueX === 'number' &&
    typeof chromaticities.blueY === 'number' &&
    typeof chromaticities.whiteX === 'number' &&
    typeof chromaticities.whiteY === 'number'
      ? (chromaticitiesToLinearColorSpace(chromaticities) ?? 'linear-rec709')
      : 'linear-rec709';

  return {
    width,
    height,
    data: pixelData,
    linearColorSpace,
    metadata: header,
  };
}
