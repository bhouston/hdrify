/**
 * RLE decompression for OpenEXR
 * OpenEXR RLE uses signed byte control codes:
 * - count < 0: copy next -count bytes literally
 * - count >= 0: repeat next byte (count + 1) times
 *
 * Post-decompression: applies predictor and reorder (same pipeline as ZIP).
 */
/**
 * Decompress RLE-compressed scanline block data.
 * Exported for testing.
 */
export declare function decompressRLE(compressedData: Uint8Array, expectedSize: number): Uint8Array;
/**
 * Decompress RLE and apply predictor + reorder (full pipeline for RLE blocks)
 */
export declare function decompressRleBlock(compressedData: Uint8Array, expectedSize: number): Uint8Array;
