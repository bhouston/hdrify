/**
 * RLE decompression for OpenEXR
 * OpenEXR RLE uses signed byte control codes:
 * - count < 0: copy next -count bytes literally
 * - count >= 0: repeat next byte (count + 1) times
 *
 * Post-decompression: applies predictor and reorder (same pipeline as ZIP).
 */

import { applyExrPredictor, reorderExrPixels } from './exrDsp.js';

/**
 * Decompress RLE-compressed scanline block data.
 * Exported for testing.
 */
export function decompressRLE(compressedData: Uint8Array, expectedSize: number): Uint8Array {
  const out = new Uint8Array(expectedSize);
  let src = 0;
  let dst = 0;

  while (src < compressedData.length && dst < expectedSize) {
    // biome-ignore lint/style/noNonNullAssertion: src < length checked in loop condition
    const count = (compressedData[src++]! << 24) >> 24; // signed byte

    if (count < 0) {
      const n = -count;
      if (src + n > compressedData.length) {
        throw new Error(
          `RLE decompression: truncated literal run (need ${n} bytes, ${compressedData.length - src} available)`,
        );
      }
      for (let i = 0; i < n && dst < expectedSize; i++) {
        // biome-ignore lint/style/noNonNullAssertion: src bounds validated by n check above
        out[dst++] = compressedData[src++]!;
      }
    } else {
      if (src >= compressedData.length) {
        throw new Error('RLE decompression: truncated repeat run (missing value byte)');
      }
      // biome-ignore lint/style/noNonNullAssertion: src < length checked above
      const value = compressedData[src++]!;
      for (let i = 0; i <= count && dst < expectedSize; i++) {
        out[dst++] = value;
      }
    }
  }

  if (dst !== expectedSize) {
    throw new Error(`RLE decompression produced wrong size: expected ${expectedSize}, got ${dst}`);
  }
  return out;
}

/**
 * Decompress RLE and apply predictor + reorder (full pipeline for RLE blocks)
 */
export function decompressRleBlock(compressedData: Uint8Array, expectedSize: number): Uint8Array {
  const rleOut = decompressRLE(compressedData, expectedSize);
  applyExrPredictor(rleOut);
  const decompressedData = new Uint8Array(expectedSize);
  reorderExrPixels(decompressedData, rleOut);
  return decompressedData;
}
