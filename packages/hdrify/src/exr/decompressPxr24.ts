/**
 * PXR24 (Pixar 24-bit) decompression for OpenEXR
 * Delta decoding + zlib. Lossless for HALF/UINT, lossy for FLOAT.
 */

import { unzlibSync } from 'fflate';
import { FLOAT, HALF, INT16_SIZE, UINT } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';

function getPxr24BytesPerSample(pixelType: number): number {
  switch (pixelType) {
    case UINT:
      return 4;
    case HALF:
      return 2;
    case FLOAT:
      return 3;
    default:
      return 2;
  }
}

function getOutputBytesPerSample(pixelType: number): number {
  switch (pixelType) {
    case UINT:
      return 4;
    case HALF:
      return INT16_SIZE;
    case FLOAT:
      return 4;
    default:
      return INT16_SIZE;
  }
}

/**
 * Decompress PXR24-compressed scanline block data.
 * Uses line-major order (OpenEXR reference: for each scanline, for each channel, transposed segment).
 * Output is channel-planar, line-major (same as ZIP/RLE) for readExr parsing.
 */
export function decompressPxr24(
  compressedData: Uint8Array,
  width: number,
  channels: ExrChannel[],
  _dataSize: number,
  blockHeight: number,
): Uint8Array {
  const raw = unzlibSync(compressedData);

  // Output is line-major, channel-planar: for each line, for each channel, width samples.
  const chBytes = channels.map((ch) => getPxr24BytesPerSample(ch.pixelType));
  const outBytes = channels.map((ch) => getOutputBytesPerSample(ch.pixelType));
  let bytesPerLine = 0;
  for (const b of outBytes) bytesPerLine += width * b;
  const output = new Uint8Array(bytesPerLine * blockHeight);
  const out16 = new Uint16Array(output.buffer);
  const out32 = new Uint32Array(output.buffer);

  let readOffset = 0;
  let writeOffset = 0;
  // Line-major (OpenEXR reference): for each scanline, for each channel, one transposed segment
  // laid out as [all byte0][all byte1]... with the delta's MSB first. Accumulator resets per segment.
  for (let ly = 0; ly < blockHeight; ly++) {
    for (let c = 0; c < channels.length; c++) {
      const pixelType = channels[c]!.pixelType;
      const segmentSize = width * chBytes[c]!;
      if (readOffset + segmentSize > raw.length) {
        throw new Error('PXR24: not enough data in decompressed stream');
      }
      const b0 = readOffset;
      const b1 = b0 + width;
      const b2 = b1 + width;
      const b3 = b2 + width;
      readOffset += segmentSize;

      let accum = 0;
      if (pixelType === HALF) {
        const o = writeOffset >> 1;
        for (let x = 0; x < width; x++) {
          accum = (accum + ((raw[b0 + x]! << 8) | raw[b1 + x]!)) & 0xffff;
          out16[o + x] = accum;
        }
      } else if (pixelType === FLOAT) {
        const o = writeOffset >> 2;
        for (let x = 0; x < width; x++) {
          accum = (accum + ((raw[b0 + x]! << 16) | (raw[b1 + x]! << 8) | raw[b2 + x]!)) & 0xffffff;
          out32[o + x] = accum << 8; // f24 -> f32 bits
        }
      } else {
        const o = writeOffset >> 2;
        for (let x = 0; x < width; x++) {
          accum = (accum + ((raw[b0 + x]! << 24) | (raw[b1 + x]! << 16) | (raw[b2 + x]! << 8) | raw[b3 + x]!)) >>> 0;
          out32[o + x] = accum;
        }
      }
      writeOffset += width * outBytes[c]!;
    }
  }

  if (readOffset !== raw.length) {
    throw new Error(`PXR24: unexpected trailing data (read ${readOffset}, total ${raw.length})`);
  }

  return output;
}
