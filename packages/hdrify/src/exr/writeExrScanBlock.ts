/**
 * EXR scan line block writer
 * Writes a single scan line block: y (4) + dataSize (4) + pixelData
 */

import type { FloatImageData } from '../floatImage.js';
import type { ExrChannel } from './exrTypes.js';
import {
  FLOAT32_SIZE,
  FLOAT,
  UINT,
  HALF,
  INT32_SIZE,
  INT16_SIZE,
  NO_COMPRESSION,
} from './exrConstants.js';

function getPixelTypeSize(pixelType: number): number {
  switch (pixelType) {
    case UINT:
      return INT32_SIZE;
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

/**
 * Write a single scan line block.
 * For NO_COMPRESSION: pixel-interleaved layout (R,G,B,A per pixel, left to right).
 * Block layout: y coordinate (4) + pixel data size (4) + pixel data.
 */
export function writeExrScanBlock(options: WriteExrScanBlockOptions): Uint8Array {
  const { floatImageData, firstLineY, lineCount, compression, channels } = options;
  const { width, height, data } = floatImageData;

  if (compression !== NO_COMPRESSION) {
    throw new Error(
      `Only NO_COMPRESSION is supported. Compression ${compression} not implemented.`,
    );
  }

  const bytesPerChannel = getPixelTypeSize(channels[0]?.pixelType ?? FLOAT);
  const numChannels = channels.length;
  const bytesPerPixel = numChannels * bytesPerChannel;
  const pixelDataSize = width * lineCount * bytesPerPixel;

  const blockSize = INT32_SIZE + INT32_SIZE + pixelDataSize;
  const result = new Uint8Array(blockSize);
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

  view.setInt32(0, firstLineY, true);
  view.setUint32(4, pixelDataSize, true);

  if (bytesPerChannel !== FLOAT32_SIZE) {
    throw new Error(
      `Only FLOAT (32-bit) pixel type is supported. Got ${channels[0]?.pixelType}.`,
    );
  }

  // Pixel-interleaved: channels in order (R,G,B,A) for each pixel
  let offset = 8;
  for (let ly = 0; ly < lineCount; ly++) {
    const y = firstLineY + ly;
    if (y >= height) break;

    for (let x = 0; x < width; x++) {
      const pixelIndex = (y * width + x) * 4;
      for (let c = 0; c < numChannels; c++) {
        const channelName = channels[c]?.name?.toLowerCase();
        const value =
          channelName === 'r' || channelName === 'red'
            ? data[pixelIndex] ?? 0
            : channelName === 'g' || channelName === 'green'
              ? data[pixelIndex + 1] ?? 0
              : channelName === 'b' || channelName === 'blue'
                ? data[pixelIndex + 2] ?? 0
                : channelName === 'a' || channelName === 'alpha'
                  ? data[pixelIndex + 3] ?? 1.0
                  : 0;
        view.setFloat32(offset, value, true);
        offset += FLOAT32_SIZE;
      }
    }
  }

  return result;
}
