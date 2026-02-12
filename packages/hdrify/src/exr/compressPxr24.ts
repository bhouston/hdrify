/**
 * PXR24 (Pixar 24-bit) compression for OpenEXR
 * Delta encoding + zlib. Lossless for HALF/UINT, lossy for FLOAT.
 * We use HALF (like ZIP) for RGB output.
 */

import { zlibSync } from 'fflate';
import { INT16_SIZE } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';
import { transposePxr24Bytes } from './pxr24Utils.js';

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

  const segmentSize = width * bytesPerSample;
  const rawParts: Uint8Array[] = [];

  // OpenEXR internal_pxr24.c apply_pxr24_impl: for (y) for (c), prevPixel = 0 per segment
  for (let ly = 0; ly < lineCount; ly++) {
    for (let c = 0; c < numChannels; c++) {
      const lineDelta = new Uint8Array(segmentSize);
      let p = 0;

      for (let x = 0; x < width; x++) {
        const offset = (ly * numChannels * width + c * width + x) * bytesPerSample;
        const lo = rawHalfFloatPlanar[offset] ?? 0;
        const hi = rawHalfFloatPlanar[offset + 1] ?? 0;
        const value = lo | (hi << 8);
        const diff = (value - p) | 0;
        p = value;
        // OpenEXR/C++ store delta high byte first (before transpose)
        lineDelta[x * 2] = (diff >> 8) & 0xff;
        lineDelta[x * 2 + 1] = diff & 0xff;
      }
      rawParts.push(transposePxr24Bytes(lineDelta, bytesPerSample));
    }
  }

  let totalLen = 0;
  for (const p of rawParts) {
    totalLen += p.length;
  }
  const raw = new Uint8Array(totalLen);
  let off = 0;
  for (const p of rawParts) {
    raw.set(p, off);
    off += p.length;
  }
  return zlibSync(raw, { level: 4 });
}
