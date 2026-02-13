/**
 * EXR scan line block writer
 * Writes a single scan line block: y (4) + dataSize (4) + pixelData
 */

import type { FloatImageData } from '../floatImage.js';
import { compressPizBlock } from './compressPiz.js';
import { compressPxr24Block } from './compressPxr24.js';
import { compressRleBlock } from './compressRle.js';
import { compressZipBlock } from './compressZip.js';
import {
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
  ZIP_COMPRESSION,
  ZIPS_COMPRESSION,
} from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';
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

function getChannelValue(data: Float32Array, pixelIndex: number, channelName: string): number {
  const n = channelName.toLowerCase();
  // biome-ignore-start lint/style/noNonNullAssertion: pixelIndex valid for RGBA data length
  if (n === 'r' || n === 'red') return data[pixelIndex]!;
  if (n === 'g' || n === 'green') return data[pixelIndex + 1]!;
  if (n === 'b' || n === 'blue') return data[pixelIndex + 2]!;
  if (n === 'a' || n === 'alpha') return data[pixelIndex + 3]!;
  // biome-ignore-end lint/style/noNonNullAssertion: pixelIndex valid for RGBA data length
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
  const useCompression =
    compression === RLE_COMPRESSION ||
    compression === ZIP_COMPRESSION ||
    compression === ZIPS_COMPRESSION ||
    compression === PIZ_COMPRESSION ||
    compression === PXR24_COMPRESSION;

  if (useCompression) {
    const pixelsPerBlock = width * lineCount;
    const interleaved = new Uint8Array(pixelsPerBlock * numChannels * 2);

    if (compression === PIZ_COMPRESSION) {
      // PIZ: scanline-interleaved [R0,G0,B0,A0, R1,G1,B1,A1, ...] per scanline
      let outOffset = 0;
      for (let ly = 0; ly < lineCount; ly++) {
        const y = firstLineY + ly;
        if (y >= height) break;
        for (let x = 0; x < width; x++) {
          const pixelIndex = (y * width + x) * 4;
          for (let c = 0; c < numChannels; c++) {
            const ch = channels[c];
            if (!ch) continue;
            const value = getChannelValue(data, pixelIndex, ch.name);
            const half = encodeFloat16(value);
            interleaved[outOffset++] = half & 0xff;
            interleaved[outOffset++] = (half >> 8) & 0xff;
          }
        }
      }
    } else {
      // RLE/ZIP/PXR24: per scanline, channel-major
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
    }

    let pixelData: Uint8Array;
    switch (compression) {
      case PIZ_COMPRESSION:
        pixelData = compressPizBlock(interleaved, width, lineCount, channels);
        break;
      case PXR24_COMPRESSION:
        pixelData = compressPxr24Block(interleaved, width, lineCount, channels);
        break;
      case RLE_COMPRESSION:
        pixelData = compressRleBlock(interleaved);
        break;
      default:
        pixelData = compressZipBlock(interleaved); // ZIP and ZIPS both use zlib
    }

    const blockSize = INT32_SIZE + INT32_SIZE + pixelData.length;
    const result = new Uint8Array(blockSize);
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
    view.setInt32(0, firstLineY, true);
    view.setUint32(4, pixelData.length, true);
    result.set(pixelData, 8);
    return result;
  }

  if (compression !== NO_COMPRESSION) {
    throw new Error(`Compression ${compression} not implemented. Supported: none, RLE, ZIP, ZIPS, PIZ, PXR24.`);
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
    throw new Error(`Only FLOAT (32-bit) pixel type is supported for uncompressed. Got ${channels[0]?.pixelType}.`);
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
