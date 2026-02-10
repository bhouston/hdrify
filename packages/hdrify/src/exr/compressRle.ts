/**
 * RLE compression for OpenEXR
 * OpenEXR RLE uses signed byte control codes:
 * - count < 0: copy next -count bytes literally
 * - count >= 0: repeat next byte (count + 1) times
 *
 * Pre-compression: reorder and predictor encode (same pipeline as ZIP).
 */

import { applyExrPredictorEncode, reorderForWriting } from './exrDspWrite.js';

const MIN_RUN_LENGTH = 3;
const MAX_RUN_LENGTH = 127;

/**
 * Compress raw bytes using OpenEXR RLE.
 * Reference: slint/exr rle.rs, OpenEXR internal_rle_compress
 */
export function compressRLE(rawData: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;

  while (i < rawData.length) {
    const runStart = i;
    let runEnd = i + 1;

    while (runEnd < rawData.length && rawData[runEnd] === rawData[runStart] && runEnd - runStart - 1 < MAX_RUN_LENGTH) {
      runEnd++;
    }

    if (runEnd - runStart >= MIN_RUN_LENGTH) {
      out.push((runEnd - runStart - 1) & 0xff);
      out.push(rawData[runStart] ?? 0);
      i = runEnd;
    } else {
      while (
        runEnd < rawData.length &&
        (runEnd + 1 >= rawData.length ||
          rawData[runEnd] !== rawData[runEnd + 1] ||
          runEnd + 2 >= rawData.length ||
          rawData[runEnd + 1] !== rawData[runEnd + 2]) &&
        runEnd - runStart < MAX_RUN_LENGTH
      ) {
        runEnd++;
      }
      out.push((runStart - runEnd) & 0xff);
      for (let j = runStart; j < runEnd; j++) {
        out.push(rawData[j] ?? 0);
      }
      i = runEnd;
    }
  }

  return new Uint8Array(out);
}

/**
 * Compress half-float interleaved data: reorder → predictor encode → RLE
 */
export function compressRleBlock(rawHalfFloatInterleaved: Uint8Array): Uint8Array {
  const planar = new Uint8Array(rawHalfFloatInterleaved.length);
  reorderForWriting(planar, rawHalfFloatInterleaved);
  applyExrPredictorEncode(planar);
  return compressRLE(planar);
}
