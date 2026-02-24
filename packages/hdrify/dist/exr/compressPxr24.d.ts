/**
 * PXR24 (Pixar 24-bit) compression for OpenEXR
 * Delta encoding + zlib. Lossless for HALF/UINT, lossy for FLOAT.
 * We use HALF (like ZIP) for RGB output.
 */
import type { ExrChannel } from './exrTypes.js';
/**
 * Compress a scanline block using PXR24.
 * Uses line-major order (OpenEXR reference): for each scanline, for each channel,
 * delta-encode that line, transpose the segment, then concatenate. Input is
 * line-major from writeExrScanBlock (line, channel, x).
 */
export declare function compressPxr24Block(rawHalfFloatPlanar: Uint8Array, width: number, lineCount: number, channels: ExrChannel[]): Uint8Array;
