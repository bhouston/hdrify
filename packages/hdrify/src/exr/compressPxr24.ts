/**
 * PXR24 (Pixar 24-bit) compression for OpenEXR
 * Delta encoding + zlib. Lossless for HALF/UINT, lossy for FLOAT.
 * We use HALF (like ZIP) for RGB output.
 */

import { zlibSync } from 'fflate';
import { INT16_SIZE } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';

/**
 * Compress a scanline block using PXR24.
 * Uses line-major order (OpenEXR reference): for each scanline, for each channel,
 * delta-encode that line, transpose the segment, then concatenate. Input is
 * line-major from writeExrScanBlock (line, channel, x).
 */
export function compressPxr24Block(
  rawHalfFloatPlanar: Uint8Array,
  width: number,
  lineCount: number,
  channels: ExrChannel[],
): Uint8Array {
  const numChannels = channels.length;
  const bytesPerSample = INT16_SIZE;
  const rawSize = width * lineCount * numChannels * bytesPerSample;

  if (rawHalfFloatPlanar.length < rawSize) {
    throw new Error(`PXR24: input too small (${rawHalfFloatPlanar.length} < ${rawSize})`);
  }

  const halves = new Uint16Array(rawHalfFloatPlanar.buffer, rawHalfFloatPlanar.byteOffset, rawSize / 2);
  const raw = new Uint8Array(rawSize);

  // OpenEXR internal_pxr24.c apply_pxr24_impl: for (y) for (c), prevPixel = 0 per segment.
  // Each segment is delta-encoded (MSB first) and byte-transposed: [all high bytes][all low bytes].
  let inOff = 0;
  let outOff = 0;
  for (let ly = 0; ly < lineCount; ly++) {
    for (let c = 0; c < numChannels; c++) {
      let p = 0;
      for (let x = 0; x < width; x++) {
        const value = halves[inOff++]!;
        const diff = value - p;
        p = value;
        raw[outOff + x] = (diff >> 8) & 0xff;
        raw[outOff + width + x] = diff & 0xff;
      }
      outOff += width * 2;
    }
  }
  return zlibSync(raw, { level: 4 });
}
