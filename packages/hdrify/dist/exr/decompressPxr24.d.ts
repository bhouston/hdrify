/**
 * PXR24 (Pixar 24-bit) decompression for OpenEXR
 * Delta decoding + zlib. Lossless for HALF/UINT, lossy for FLOAT.
 */
import type { ExrChannel } from './exrTypes.js';
/**
 * Decompress PXR24-compressed scanline block data.
 * Uses line-major order (OpenEXR reference: for each scanline, for each channel, transposed segment).
 * Output is channel-planar, line-major (same as ZIP/RLE) for readExr parsing.
 */
export declare function decompressPxr24(compressedData: Uint8Array, width: number, channels: ExrChannel[], _dataSize: number, blockHeight: number): Uint8Array;
