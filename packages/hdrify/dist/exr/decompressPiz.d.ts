/**
 * PIZ decompression for OpenEXR
 * PIZ compression uses blocks of 32 scanlines (or fewer for the last block)
 */
import type { ExrChannel } from './exrTypes.js';
/**
 * Decompress PIZ-compressed scanline block data
 */
export declare function decompressPiz(compressedData: Uint8Array, width: number, channels: ExrChannel[], _dataSize: number, blockHeight?: number): Uint8Array;
