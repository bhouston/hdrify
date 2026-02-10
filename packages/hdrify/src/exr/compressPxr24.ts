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
 * Input: channel-planar half-float (same layout as ZIP/RLE from writeExrScanBlock).
 * For each channel: delta encode (diff from left neighbor), then zlib.
 */
export function compressPxr24Block(
  rawHalfFloatPlanar: Uint8Array,
  width: number,
  lineCount: number,
  channels: ExrChannel[],
): Uint8Array {
  const numChannels = channels.length;
  const samplesPerChannel = width * lineCount;

  // PXR24 with HALF: 2 bytes per sample
  const bytesPerSample = INT16_SIZE;
  const rawSize = samplesPerChannel * numChannels * bytesPerSample;

  if (rawHalfFloatPlanar.length < rawSize) {
    throw new Error(
      `PXR24: input too small (${rawHalfFloatPlanar.length} < ${rawSize})`,
    );
  }

  const deltaBuffer: number[] = [];

  // Input is line-major: for each line, for each channel, for each pixel
  for (let c = 0; c < numChannels; c++) {
    let prev = 0;

    for (let ly = 0; ly < lineCount; ly++) {
      for (let x = 0; x < width; x++) {
        const offset =
          (ly * numChannels * width + c * width + x) * bytesPerSample;
        const lo = rawHalfFloatPlanar[offset] ?? 0;
        const hi = rawHalfFloatPlanar[offset + 1] ?? 0;
        const value = lo | (hi << 8);

        const diff = (value - prev) & 0xffff;
        prev = value;

        deltaBuffer.push(diff & 0xff, (diff >> 8) & 0xff);
      }
    }
  }

  const raw = new Uint8Array(deltaBuffer.length);
  for (let i = 0; i < deltaBuffer.length; i++) {
    raw[i] = deltaBuffer[i]!;
  }

  return zlibSync(raw, { level: 4 });
}
