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
export declare function reorderForWriting(dst: Uint8Array, src: Uint8Array): void;
/**
 * Apply OpenEXR predictor (delta encoding) in-place.
 * Inverse of applyExrPredictor. Encodes differences for ZIP/RLE compression.
 * Input: raw (decoded) values. Output: encoded values that decode back to input.
 */
export declare function applyExrPredictorEncode(src: Uint8Array): void;
