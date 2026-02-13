/**
 * PXR24 (Pixar 24-bit) decompression for OpenEXR
 * Delta decoding + zlib. Lossless for HALF/UINT, lossy for FLOAT.
 */

import { unzlibSync } from 'fflate';
import { FLOAT, HALF, INT16_SIZE, UINT } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';
import { f24ToFloat32, undoPxr24Transposition } from './pxr24Utils.js';

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

  const numChannels = channels.length;
  const samplesPerChannel = width * blockHeight;

  let totalOutputSize = 0;
  const channelMeta: { chBytesPerSample: number; outBytesPerSample: number }[] = [];
  for (const ch of channels) {
    const chBytesPerSample = getPxr24BytesPerSample(ch.pixelType);
    const outBytesPerSample = getOutputBytesPerSample(ch.pixelType);
    channelMeta.push({ chBytesPerSample, outBytesPerSample });
    totalOutputSize += samplesPerChannel * outBytesPerSample;
  }

  const channelData: { bytesPerSample: number; values: Uint8Array }[] = [];
  for (let c = 0; c < numChannels; c++) {
    const outBytesPerSample = channelMeta[c]?.outBytesPerSample ?? 2;
    channelData.push({
      bytesPerSample: outBytesPerSample,
      values: new Uint8Array(samplesPerChannel * outBytesPerSample),
    });
  }

  let readOffset = 0;
  const accum: number[] = [];
  for (let c = 0; c < numChannels; c++) {
    accum.push(0);
  }

  // Line-major (OpenEXR reference): for each scanline, for each channel, one transposed segment
  for (let ly = 0; ly < blockHeight; ly++) {
    for (let c = 0; c < numChannels; c++) {
      const channel = channels[c];
      if (!channel) continue;

      const { chBytesPerSample, outBytesPerSample } = channelMeta[c] ?? {
        chBytesPerSample: 2,
        outBytesPerSample: 2,
      };

      const chOut = channelData[c]?.values;
      const chView = chOut != null ? new DataView(chOut.buffer, chOut.byteOffset, chOut.byteLength) : null;

      // Reset accumulator for each scanline per channel (reference: pixel = 0 per segment)
      accum[c] = 0;

      const segmentSize = width * chBytesPerSample;
      if (readOffset + segmentSize > raw.length) {
        throw new Error('PXR24: not enough data in decompressed stream');
      }
      const segment = raw.subarray(readOffset, readOffset + segmentSize);
      readOffset += segmentSize;

      const untransposed = undoPxr24Transposition(segment, chBytesPerSample);

      if (chOut == null || chView == null) continue;

      const lineStart = ly * width;

      for (let x = 0; x < width; x++) {
        const s = lineStart + x;
        const byteOff = x * chBytesPerSample;
        // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by width*chBytesPerSample and accum init
        let diff: number;
        if (channel.pixelType === HALF) {
          // OpenEXR/C++ store delta high byte first in segment; after untranspose we have [high, low] per sample
          const u16 = (untransposed[byteOff]! << 8) | untransposed[byteOff + 1]!;
          diff = u16 > 0x7fff ? u16 - 0x10000 : u16;
          accum[c] = (accum[c]! + diff) & 0xffff;
          chView.setUint16(s * outBytesPerSample, accum[c]!, true);
        } else if (channel.pixelType === FLOAT) {
          // 24-bit: C++ stores MSB first
          const u24 = (untransposed[byteOff]! << 16) | (untransposed[byteOff + 1]! << 8) | untransposed[byteOff + 2]!;
          diff = u24 > 0x7fffff ? u24 - 0x1000000 : u24;
          accum[c] = (accum[c]! + diff) & 0xffffff;
          const f32 = f24ToFloat32(accum[c]! & 0xff, (accum[c]! >> 8) & 0xff, (accum[c]! >> 16) & 0xff);
          chView.setFloat32(s * outBytesPerSample, f32, true);
        } else {
          // UINT: C++ stores MSB first
          const u32 =
            (untransposed[byteOff]! << 24) |
            (untransposed[byteOff + 1]! << 16) |
            (untransposed[byteOff + 2]! << 8) |
            untransposed[byteOff + 3]!;
          diff = u32 > 0x7fffffff ? u32 - 0x100000000 : u32;
          accum[c] = (accum[c]! + diff) >>> 0;
          chView.setUint32(s * outBytesPerSample, accum[c]!, true);
        }
        // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by width*chBytesPerSample and accum init
      }
    }
  }

  if (readOffset !== raw.length) {
    throw new Error(`PXR24: unexpected trailing data (read ${readOffset}, total ${raw.length})`);
  }

  const output = new Uint8Array(totalOutputSize);
  let writeOffset = 0;
  for (let ly = 0; ly < blockHeight; ly++) {
    for (let c = 0; c < numChannels; c++) {
      const { bytesPerSample: bs, values } = channelData[c] ?? {
        bytesPerSample: 0,
        values: new Uint8Array(0),
      };
      const chLineStart = ly * width * bs;
      for (let x = 0; x < width; x++) {
        const srcOffset = chLineStart + x * bs;
        for (let b = 0; b < bs; b++) {
          // biome-ignore lint/style/noNonNullAssertion: index bounds-checked by channel layout
          output[writeOffset++] = values[srcOffset + b]!;
        }
      }
    }
  }

  return output;
}
