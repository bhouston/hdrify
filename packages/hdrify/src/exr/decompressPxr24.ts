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
 * Output is channel-planar, line-major (same as ZIP/RLE) for readExr parsing.
 * Layout: for each scanline, for each channel, for each pixel.
 */
export function decompressPxr24(
  compressedData: Uint8Array,
  width: number,
  channels: ExrChannel[],
  _dataSize: number,
  blockHeight: number,
): Uint8Array {
  let raw = unzlibSync(compressedData);

  const samplesPerChannel = width * blockHeight;

  // OpenEXR PXR24 uses byte transposition. Apply per-channel (matches external tools like Blender).
  // Format: [ch0_lo][ch0_hi][ch1_lo][ch1_hi]... per channel.
  const rawUntransposed = new Uint8Array(raw.length);
  let off = 0;
  for (const ch of channels) {
    const chBytesPerSample = getPxr24BytesPerSample(ch.pixelType);
    const chBytes = samplesPerChannel * chBytesPerSample;
    const chRaw = raw.subarray(off, off + chBytes);
    rawUntransposed.set(undoPxr24Transposition(chRaw, chBytesPerSample), off);
    off += chBytes;
  }
  raw = rawUntransposed;

  let totalOutputSize = 0;
  for (const ch of channels) {
    totalOutputSize += samplesPerChannel * getOutputBytesPerSample(ch.pixelType);
  }

  const output = new Uint8Array(totalOutputSize);

  let readOffset = 0;

  // Decompress each channel (raw buffer is channel-major)
  const channelData: { bytesPerSample: number; values: Uint8Array }[] = [];

  for (const channel of channels) {
    const chBytesPerSample = getPxr24BytesPerSample(channel.pixelType);
    const outBytesPerSample = getOutputBytesPerSample(channel.pixelType);
    const chOut = new Uint8Array(samplesPerChannel * outBytesPerSample);
    const chView = new DataView(chOut.buffer, chOut.byteOffset, chOut.byteLength);

    let accum = 0;

    for (let s = 0; s < samplesPerChannel; s++) {
      if (readOffset + chBytesPerSample > raw.length) {
        throw new Error('PXR24: not enough data in decompressed stream');
      }

      let diff: number;
      if (channel.pixelType === HALF) {
        diff = raw[readOffset]! | (raw[readOffset + 1]! << 8);
        accum = (accum + diff) & 0xffff;
        chView.setUint16(s * outBytesPerSample, accum, true);
      } else if (channel.pixelType === FLOAT) {
        diff = raw[readOffset]! | (raw[readOffset + 1]! << 8) | (raw[readOffset + 2]! << 16);
        accum = (accum + diff) & 0xffffff;
        const f32 = f24ToFloat32(accum & 0xff, (accum >> 8) & 0xff, (accum >> 16) & 0xff);
        chView.setFloat32(s * outBytesPerSample, f32, true);
      } else {
        diff =
          raw[readOffset]! | (raw[readOffset + 1]! << 8) | (raw[readOffset + 2]! << 16) | (raw[readOffset + 3]! << 24);
        accum = (accum + diff) >>> 0;
        chView.setUint32(s * outBytesPerSample, accum, true);
      }

      readOffset += chBytesPerSample;
    }

    channelData.push({ bytesPerSample: outBytesPerSample, values: chOut });
  }

  // Reorder to line-major (for each line, for each channel, for each pixel)
  let writeOffset = 0;
  for (let ly = 0; ly < blockHeight; ly++) {
    for (let c = 0; c < channels.length; c++) {
      const { bytesPerSample: bs, values } = channelData[c]!;
      const chLineStart = ly * width * bs;
      for (let x = 0; x < width; x++) {
        const srcOffset = chLineStart + x * bs;
        for (let b = 0; b < bs; b++) {
          output[writeOffset++] = values[srcOffset + b]!;
        }
      }
    }
  }

  return output;
}
