/**
 * ZIP compression for OpenEXR
 * Uses deflate (zlib) with predictor + reorder pre-processing
 */

import { zlibSync } from 'fflate';
import { applyExrPredictorEncode, reorderForWriting } from './exrDspWrite.js';

/**
 * Compress raw bytes using zlib
 */
export function compressZip(rawData: Uint8Array): Uint8Array {
  return zlibSync(rawData, { level: 4 });
}

/**
 * Compress half-float interleaved data: reorder → predictor encode → zlib
 */
export function compressZipBlock(rawHalfFloatInterleaved: Uint8Array): Uint8Array {
  const planar = new Uint8Array(rawHalfFloatInterleaved.length);
  reorderForWriting(planar, rawHalfFloatInterleaved);
  applyExrPredictorEncode(planar);
  return compressZip(planar);
}
