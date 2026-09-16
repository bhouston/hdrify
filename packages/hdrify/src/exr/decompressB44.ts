/**
 * B44/B44A decompression for OpenEXR.
 * Lossy 4x4-block compression for HALF channels only; FLOAT/UINT channels
 * are stored uncompressed. See b44Codec.ts for the core block codec.
 */

import { convertBlockToLinear, unpackB44Block14, unpackB44Block3 } from './b44Codec.js';
import { FLOAT, FLOAT32_SIZE, HALF, INT16_SIZE, UINT } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';

function getBytesPerSample(pixelType: number): number {
  switch (pixelType) {
    case UINT:
      return 4;
    case HALF:
      return INT16_SIZE;
    case FLOAT:
      return FLOAT32_SIZE;
    default:
      return INT16_SIZE;
  }
}

/**
 * Decompress a B44/B44A-compressed scanline block.
 * Output is channel-planar, line-major (same convention as PXR24/DWA) for readExr parsing.
 */
export function decompressB44(
  compressedData: Uint8Array,
  width: number,
  channels: ExrChannel[],
  _dataSize: number,
  blockHeight: number,
): Uint8Array {
  const numChannels = channels.length;
  const s = new Uint16Array(16);
  let readOffset = 0;

  const channelScratch: Uint8Array[] = [];

  for (let c = 0; c < numChannels; c++) {
    const channel = channels[c]!;
    const bytesPerSample = getBytesPerSample(channel.pixelType);
    const nBytes = width * blockHeight * bytesPerSample;
    const scratch = new Uint8Array(nBytes);
    channelScratch.push(scratch);
    if (nBytes === 0) continue;

    if (channel.pixelType !== HALF) {
      if (readOffset + nBytes > compressedData.length) {
        throw new Error('B44: not enough data for uncompressed channel');
      }
      scratch.set(compressedData.subarray(readOffset, readOffset + nBytes));
      readOffset += nBytes;
      continue;
    }

    const view = new Uint16Array(scratch.buffer);

    for (let y = 0; y < blockHeight; y += 4) {
      for (let x = 0; x < width; x += 4) {
        if (readOffset + 3 > compressedData.length) {
          throw new Error('B44: truncated block data');
        }
        if (compressedData[readOffset + 2]! >= 13 << 2) {
          unpackB44Block3(compressedData.subarray(readOffset, readOffset + 3), s);
          readOffset += 3;
        } else {
          if (readOffset + 14 > compressedData.length) {
            throw new Error('B44: truncated block data');
          }
          unpackB44Block14(compressedData.subarray(readOffset, readOffset + 14), s);
          readOffset += 14;
        }

        if (channel.pLinear) convertBlockToLinear(s);

        const colsToWrite = Math.min(4, width - x);
        const rowsToWrite = Math.min(4, blockHeight - y);
        for (let ry = 0; ry < rowsToWrite; ry++) {
          const lineStart = (y + ry) * width;
          for (let rx = 0; rx < colsToWrite; rx++) {
            view[lineStart + x + rx] = s[ry * 4 + rx]!;
          }
        }
      }
    }
  }

  const totalOutputSize = channelScratch.reduce((sum, ch) => sum + ch.length, 0);
  const output = new Uint8Array(totalOutputSize);
  let writeOffset = 0;
  for (let ly = 0; ly < blockHeight; ly++) {
    for (let c = 0; c < numChannels; c++) {
      const channel = channels[c]!;
      const bytesPerSample = getBytesPerSample(channel.pixelType);
      const scratch = channelScratch[c]!;
      const lineStart = ly * width * bytesPerSample;
      const lineLength = width * bytesPerSample;
      output.set(scratch.subarray(lineStart, lineStart + lineLength), writeOffset);
      writeOffset += lineLength;
    }
  }

  return output;
}
