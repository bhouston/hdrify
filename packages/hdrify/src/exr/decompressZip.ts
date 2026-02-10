/**
 * ZIP decompression for OpenEXR
 * Uses deflate (zlib) with predictor + reorder post-processing
 */

import { unzlibSync } from 'fflate';
import { applyExrPredictor, reorderExrPixels } from './exrDsp.js';

/**
 * Decompress ZIP-compressed scanline block data
 */
export function decompressZip(compressedData: Uint8Array): Uint8Array {
  const decompressed = unzlibSync(compressedData);
  applyExrPredictor(decompressed);
  const result = new Uint8Array(decompressed.length);
  reorderExrPixels(result, decompressed);
  return result;
}
