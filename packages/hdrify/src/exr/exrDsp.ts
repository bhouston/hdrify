/**
 * EXR DSP (Digital Signal Processing) utilities
 * Predictor and reorder_pixels - used by ZIP and RLE decompression.
 * Matches FFmpeg exrdsp.
 */

/**
 * Apply OpenEXR predictor (delta decoding) in-place.
 * Matches FFmpeg exrdsp predictor_scalar. Reverses the difference encoding
 * used by ZIP and RLE compressors.
 */
export function applyExrPredictor(src: Uint8Array): void {
  const size = src.length;
  if (size < 2) return;
  if ((size & 1) === 0) {
    src[1] = (src[1]! + (src[0]! ^ 0x80)) & 0xff;
  }
  // FFmpeg shifts pointer after first pair, so loop processes (1,2),(3,4),(5,6)...
  for (let i = 2; i < size - 1; i += 2) {
    const a = (src[i - 1]! + src[i]!) & 0xff;
    src[i] = a;
    src[i + 1] = (src[i + 1]! + a) & 0xff;
    src[i] = (a ^ 0x80) & 0xff;
  }
}

/**
 * Reorder pixels from channel-planar to byte-interleaved.
 * Matches FFmpeg exrdsp reorder_pixels. Converts [low bytes][high bytes]
 * to [low0,high0, low1,high1, ...] for 16-bit half data.
 */
export function reorderExrPixels(dst: Uint8Array, src: Uint8Array): void {
  const halfSize = Math.floor(src.length / 2);
  const t1 = src.subarray(0, halfSize);
  const t2 = src.subarray(halfSize, halfSize * 2);
  for (let i = 0; i < halfSize; i++) {
    dst[i * 2] = t1[i]!;
    dst[i * 2 + 1] = t2[i]!;
  }
}
