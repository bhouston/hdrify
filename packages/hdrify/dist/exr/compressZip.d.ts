/**
 * ZIP compression for OpenEXR
 * Uses deflate (zlib) with predictor + reorder pre-processing
 */
/**
 * Compress raw bytes using zlib
 */
export declare function compressZip(rawData: Uint8Array): Uint8Array;
/**
 * Compress half-float interleaved data: reorder → predictor encode → zlib
 */
export declare function compressZipBlock(rawHalfFloatInterleaved: Uint8Array): Uint8Array;
