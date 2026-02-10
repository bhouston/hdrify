/**
 * EXR scan line block writer
 * Writes a single scan line block: y (4) + dataSize (4) + pixelData
 */

import type { FloatImageData } from '../floatImage.js';
import type { ExrChannel } from './exrTypes.js';
import {
  FLOAT32_SIZE,
  FLOAT,
  HALF,
  INT16_SIZE,
  INT32_SIZE,
  NO_COMPRESSION,
  RLE_COMPRESSION,
  UINT,
  ZIP_COMPRESSION,
  ZIPS_COMPRESSION,
} from './exrConstants.js';
import { compressRleBlock } from './compressRle.js';
import { compressZipBlock } from './compressZip.js';
import { encodeFloat16 } from './halfFloat.js';

function getPixelTypeSize(pixelType: number): number {
  switch (pixelType) {
    case UINT:
      return 4;
    case HALF:
      return INT16_SIZE;
    case FLOAT:
      return FLOAT32_SIZE;
    default:
      return FLOAT32_SIZE;
  }
}

export interface WriteExrScanBlockOptions {
  floatImageData: FloatImageData;
  firstLineY: number;
  lineCount: number;
  compression: number;
  channels: ExrChannel[];
}

function getChannelValue(
  data: Float32Array,
  pixelIndex: number,
  channelName: string,
): number {
  const n = channelName.toLowerCase();
  if (n === 'r' || n === 'red') return data[pixelIndex] ?? 0;
  if (n === 'g' || n === 'green') return data[pixelIndex + 1] ?? 0;
  if (n === 'b' || n === 'blue') return data[pixelIndex + 2] ?? 0;
  if (n === 'a' || n === 'alpha') return data[pixelIndex + 3] ?? 1.0;
  return 0;
}

/**
 * Write a single scan line block.
 * For NO_COMPRESSION: pixel-interleaved layout (R,G,B,A per pixel, left to right).
 * For RLE/ZIP: half-float, reorder + predictor + compress.
 * Block layout: y coordinate (4) + pixel data size (4) + pixel data.
 */
export function writeExrScanBlock(options: WriteExrScanBlockOptions): Uint8Array {
  const { floatImageData, firstLineY, lineCount, compression, channels } = options;
  const { width, height, data } = floatImageData;

  const numChannels = channels.length;
  const useCompression = compression === RLE_COMPRESSION || compression === ZIP_COMPRESSION || compression === ZIPS_COMPRESSION;

  if (useCompression) {
    const pixelsPerBlock = width * lineCount;
    const interleaved = new Uint8Array(pixelsPerBlock * numChannels * 2);

    // Per scanline, channel-major (per OpenEXR planar layout): for each line, for each channel, for each pixel, [low, high]
    let outOffset = 0;
    for (let ly = 0; ly < lineCount; ly++) {
      const y = firstLineY + ly;
      if (y >= height) break;

      for (let c = 0; c < numChannels; c++) {
        const ch = channels[c];
        if (!ch) continue;
        for (let x = 0; x < width; x++) {
          const pixelIndex = (y * width + x) * 4;
          const value = getChannelValue(data, pixelIndex, ch.name);
          const half = encodeFloat16(value);
          interleaved[outOffset++] = half & 0xff;
          interleaved[outOffset++] = (half >> 8) & 0xff;
        }
      }
    }

    const pixelData =
      compression === RLE_COMPRESSION || compression === ZIPS_COMPRESSION
        ? compressRleBlock(interleaved)
        : compressZipBlock(interleaved); // ZIP_COMPRESSION

    const blockSize = INT32_SIZE + INT32_SIZE + pixelData.length;
    const result = new Uint8Array(blockSize);
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
    view.setInt32(0, firstLineY, true);
    view.setUint32(4, pixelData.length, true);
    result.set(pixelData, 8);
    return result;
  }

  if (compression !== NO_COMPRESSION) {
    throw new Error(
      `Compression ${compression} not implemented. Supported: none, RLE, ZIP, ZIPS.`,
    );
  }

  const bytesPerChannel = getPixelTypeSize(channels[0]?.pixelType ?? FLOAT);
  const bytesPerPixel = numChannels * bytesPerChannel;
  const pixelDataSize = width * lineCount * bytesPerPixel;

  const blockSize = INT32_SIZE + INT32_SIZE + pixelDataSize;
  const result = new Uint8Array(blockSize);
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

  view.setInt32(0, firstLineY, true);
  view.setUint32(4, pixelDataSize, true);

  if (bytesPerChannel !== FLOAT32_SIZE) {
    throw new Error(
      `Only FLOAT (32-bit) pixel type is supported for uncompressed. Got ${channels[0]?.pixelType}.`,
    );
  }

  let offset = 8;
  for (let ly = 0; ly < lineCount; ly++) {
    const y = firstLineY + ly;
    if (y >= height) break;

    for (let x = 0; x < width; x++) {
      const pixelIndex = (y * width + x) * 4;
      for (let c = 0; c < numChannels; c++) {
        const ch = channels[c];
        if (!ch) continue;
        const value = getChannelValue(data, pixelIndex, ch.name);
        view.setFloat32(offset, value, true);
        offset += FLOAT32_SIZE;
      }
    }
  }

  return result;
}
