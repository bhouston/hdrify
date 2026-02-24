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
export declare function applyExrPredictor(src: Uint8Array): void;
/**
 * Reorder pixels from channel-planar to byte-interleaved.
 * Matches FFmpeg exrdsp reorder_pixels. Converts [low bytes][high bytes]
 * to [low0,high0, low1,high1, ...] for 16-bit half data.
 */
export declare function reorderExrPixels(dst: Uint8Array, src: Uint8Array): void;
