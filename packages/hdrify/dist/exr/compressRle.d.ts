/**
 * RLE compression for OpenEXR
 * OpenEXR RLE uses signed byte control codes:
 * - count < 0: copy next -count bytes literally
 * - count >= 0: repeat next byte (count + 1) times
 *
 * Pre-compression: reorder and predictor encode (same pipeline as ZIP).
 */
/**
 * Compress raw bytes using OpenEXR RLE.
 * Reference: slint/exr rle.rs, OpenEXR internal_rle_compress
 */
export declare function compressRLE(rawData: Uint8Array): Uint8Array;
/**
 * Compress half-float interleaved data: reorder → predictor encode → RLE
 */
export declare function compressRleBlock(rawHalfFloatInterleaved: Uint8Array): Uint8Array;
