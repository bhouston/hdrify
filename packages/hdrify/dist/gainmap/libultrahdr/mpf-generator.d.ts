/**
 * Multi-Picture Format (MPF) generator
 * Based on CIPA DC-007 specification and libultrahdr multipictureformat.cpp
 *
 * MPF is used to embed multiple images in a single JPEG file
 */
/**
 * Calculate the total size of the MPF structure
 */
export declare function calculateMpfSize(): number;
/**
 * Generate MPF (Multi-Picture Format) data structure
 */
export declare function generateMpf(primaryImageSize: number, primaryImageOffset: number, secondaryImageSize: number, secondaryImageOffset: number): Uint8Array;
