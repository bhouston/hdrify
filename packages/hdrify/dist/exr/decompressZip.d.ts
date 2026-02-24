/**
 * ZIP decompression for OpenEXR
 * Uses deflate (zlib) with predictor + reorder post-processing
 */
/**
 * Decompress ZIP-compressed scanline block data
 */
export declare function decompressZip(compressedData: Uint8Array): Uint8Array;
