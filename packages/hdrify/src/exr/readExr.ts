/**
 * EXR (OpenEXR) file reader
 *
 * Extracted and adapted from Three.js EXRLoader
 * Supports PIZ, ZIP, RLE, and uncompressed EXR files
 */

import { chromaticitiesToLinearColorSpace } from '../color/colorSpaces.js';
import { ensureNonNegativeFinite, type HdrifyImage } from '../hdrifyImage.js';
import { decompressPiz } from './decompressPiz.js';
import { decompressPxr24 } from './decompressPxr24.js';
import { decompressRleBlock } from './decompressRle.js';
import { decompressZip } from './decompressZip.js';
import {
  FLOAT32_SIZE,
  INT16_SIZE,
  INT32_SIZE,
  NO_COMPRESSION,
  PIZ_COMPRESSION,
  PXR24_COMPRESSION,
  RLE_COMPRESSION,
  ULONG_SIZE,
  ZIP_COMPRESSION,
  ZIPS_COMPRESSION,
} from './exrConstants.js';
import { parseExrHeader } from './exrHeader.js';
import { decodeFloat16 } from './halfFloat.js';

function getPixelTypeSize(pixelType: number): number {
  const UINT = 0;
  const HALF = 1;
  const FLOAT = 2;
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

function readChannelValue(dataView: DataView, offset: number, pixelType: number): number {
  const UINT = 0;
  const HALF = 1;
  const FLOAT = 2;
  switch (pixelType) {
    case UINT:
      return dataView.getUint32(offset, true);
    case HALF:
      return decodeFloat16(dataView.getUint16(offset, true));
    case FLOAT:
      return dataView.getFloat32(offset, true);
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
export function readExr(exrBuffer: Uint8Array): HdrifyImage {
  const dataView = new DataView(exrBuffer.buffer, exrBuffer.byteOffset, exrBuffer.byteLength);
  const { header: parsedHeader, offset } = parseExrHeader(exrBuffer);

  const { header, dataWindow, channels, compression } = parsedHeader;
  const width = dataWindow.xMax - dataWindow.xMin + 1;
  const height = dataWindow.yMax - dataWindow.yMin + 1;

  // Find RGB channels (case-insensitive, check exact match first)
  const rChannel = channels.find((ch) => ch.name === 'R' || ch.name === 'r' || ch.name.toLowerCase() === 'red');
  const gChannel = channels.find((ch) => ch.name === 'G' || ch.name === 'g' || ch.name.toLowerCase() === 'green');
  const bChannel = channels.find((ch) => ch.name === 'B' || ch.name === 'b' || ch.name.toLowerCase() === 'blue');

  if (!rChannel || !gChannel || !bChannel) {
    throw new Error('Non-RGB EXR files are not supported. This reader requires R, G, and B channels.');
  }

  const numChannels = channels.length;

  // Determine block height based on compression type (OpenEXR spec: ZIP/PXR24=16, PIZ=32, others=1)
  const blockHeight =
    compression === PIZ_COMPRESSION
      ? 32
      : compression === ZIP_COMPRESSION || compression === PXR24_COMPRESSION
        ? 16
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
            `This file may use a compression or layout not supported by this reader. Supported: none, RLE, ZIPS, ZIP, PIZ, PXR24.`,
        );
      }
      throw new Error(
        `Invalid scanline block data size: ${dataSize} at offset ${scanlinePos - 4} (file size: ${exrBuffer.length}, available: ${available})`,
      );
    }

    const linesInBlock = Math.min(actualBlockHeightFinal, height - firstLineY);

    // Decompress block data
    let decompressedData: Uint8Array;
    if (compression === NO_COMPRESSION) {
      decompressedData = new Uint8Array(exrBuffer.buffer, exrBuffer.byteOffset + scanlinePos, dataSize);
    } else if (compression === ZIP_COMPRESSION || compression === ZIPS_COMPRESSION) {
      const compressedData = new Uint8Array(exrBuffer.buffer, exrBuffer.byteOffset + scanlinePos, dataSize);
      decompressedData = decompressZip(compressedData);
    } else if (compression === RLE_COMPRESSION) {
      const compressedData = new Uint8Array(exrBuffer.buffer, exrBuffer.byteOffset + scanlinePos, dataSize);
      const expectedSize = linesInBlock * width * numChannels * getPixelTypeSize(rChannel.pixelType);
      decompressedData = decompressRleBlock(compressedData, expectedSize);
    } else if (compression === PIZ_COMPRESSION) {
      if (dataSize <= 0 || scanlinePos + dataSize > exrBuffer.length) {
        throw new Error(`Invalid PIZ data size: ${dataSize} at offset ${scanlinePos} (file size: ${exrBuffer.length})`);
      }
      const compressedData = new Uint8Array(exrBuffer.buffer, exrBuffer.byteOffset + scanlinePos, dataSize);
      decompressedData = decompressPiz(compressedData, width, channels, dataSize, actualBlockHeightFinal);
    } else if (compression === PXR24_COMPRESSION) {
      if (dataSize <= 0 || scanlinePos + dataSize > exrBuffer.length) {
        throw new Error(
          `Invalid PXR24 data size: ${dataSize} at offset ${scanlinePos} (file size: ${exrBuffer.length})`,
        );
      }
      const compressedData = new Uint8Array(exrBuffer.buffer, exrBuffer.byteOffset + scanlinePos, dataSize);
      decompressedData = decompressPxr24(compressedData, width, channels, dataSize, linesInBlock);
    } else {
      throw new Error(`Unsupported compression type: ${compression}`);
    }

    // Parse pixel data from decompressed block
    const blockDataView = new DataView(
      decompressedData.buffer,
      decompressedData.byteOffset,
      decompressedData.byteLength,
    );

    const bytesPerScanline = width * numChannels * getPixelTypeSize(rChannel.pixelType);
    const bytesPerChannel = getPixelTypeSize(rChannel.pixelType);

    const isPlanar =
      compression === RLE_COMPRESSION ||
      compression === ZIP_COMPRESSION ||
      compression === ZIPS_COMPRESSION ||
      compression === PXR24_COMPRESSION;

    for (let lineInBlock = 0; lineInBlock < linesInBlock; lineInBlock++) {
      const y = firstLineY + lineInBlock;
      if (y >= height) {
        break;
      }

      const lineOffset = compression === NO_COMPRESSION ? 0 : lineInBlock * bytesPerScanline;

      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * 4;

        const channelValues: { [key: string]: number } = {};

        // PXR24 with 3 channels: decoder outputs in header order (e.g. B, G, R). Map to R,G,B by
        // semantic: block 0 = first in header (e.g. B), block 1 = G, block 2 = R. So R=block2, G=block1, B=block0.
        const usePxr24RgbBlockOrder = isPlanar && compression === PXR24_COMPRESSION && numChannels === 3;

        if (usePxr24RgbBlockOrder) {
          channelValues.r = readChannelValue(
            blockDataView,
            lineOffset + 2 * width * bytesPerChannel + x * bytesPerChannel,
            rChannel.pixelType,
          );
          channelValues.g = readChannelValue(
            blockDataView,
            lineOffset + 1 * width * bytesPerChannel + x * bytesPerChannel,
            rChannel.pixelType,
          );
          channelValues.b = readChannelValue(
            blockDataView,
            lineOffset + 0 * width * bytesPerChannel + x * bytesPerChannel,
            rChannel.pixelType,
          );
        } else {
          for (let c = 0; c < channels.length; c++) {
            const channel = channels[c];
            if (channel === undefined) continue;
            const pixelOffset = isPlanar
              ? lineOffset + c * width * bytesPerChannel + x * bytesPerChannel
              : lineOffset + x * numChannels * bytesPerChannel + c * bytesPerChannel;
            const value = readChannelValue(blockDataView, pixelOffset, channel.pixelType);
            channelValues[channel.name.toLowerCase()] = value;
          }
        }

        pixelData[pixelIndex] = channelValues.r ?? channelValues.red ?? 0;
        pixelData[pixelIndex + 1] = channelValues.g ?? channelValues.green ?? 0;
        pixelData[pixelIndex + 2] = channelValues.b ?? channelValues.blue ?? 0;
        pixelData[pixelIndex + 3] = channelValues.a ?? channelValues.alpha ?? 1.0;
      }
    }
  }

  ensureNonNegativeFinite(pixelData);

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
