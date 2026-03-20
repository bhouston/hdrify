/**
 * EXR DSP (Digital Signal Processing) utilities for writing
 * Inverse of exrDsp: reorder for planar layout, predictor encode.
 * Used by ZIP and RLE compression.
 */

/**
 * Reorder pixels from byte-interleaved to channel-planar for compression.
 * Inverse of reorderExrPixels. Converts [low0,high0, low1,high1, ...]
 * to [low0,low1,...][high0,high1,...] for 16-bit half data.
 */
export function reorderForWriting(dst: Uint8Array, src: Uint8Array): void {
  const halfSize = Math.floor(src.length / 2);
  const t1 = dst.subarray(0, halfSize);
  const t2 = dst.subarray(halfSize, halfSize * 2);
  for (let i = 0; i < halfSize; i++) {
    t1[i] = src[i * 2]!;
    t2[i] = src[i * 2 + 1]!;
  }
}

/**
 * Apply OpenEXR predictor (delta encoding) in-place.
 * Inverse of applyExrPredictor. Encodes differences for ZIP/RLE compression.
 * Input: raw (decoded) values. Output: encoded values that decode back to input.
 */
export function applyExrPredictorEncode(src: Uint8Array): void {
  const size = src.length;
  if (size < 2) return;
  let prev: number;
  if ((size & 1) === 0) {
    prev = src[1]!;
    src[1] = (prev - (src[0]! ^ 0x80) + 256) & 0xff;
  } else {
    prev = src[1]!;
  }
  for (let i = 2; i < size - 1; i += 2) {
    const rawI = src[i]!;
    const rawI1 = src[i + 1]!;
    src[i] = ((rawI ^ 0x80) - prev + 256) & 0xff;
    src[i + 1] = (rawI1 - (rawI ^ 0x80) + 256) & 0xff;
    prev = rawI1;
  }
}
