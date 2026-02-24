/**
 * PIZ compression for OpenEXR
 * PIZ uses: bitmap + LUT + 2D Haar wavelet + Huffman encoding
 * Block size: 32 scanlines (or fewer for last block)
 */
import type { ExrChannel } from './exrTypes.js';
/**
 * Build bitmap from uint16 data. bitmap[i>>3] |= 1<<(i&7) for each value.
 * Zero is implicit (bitmap[0] &= ~1).
 */
export declare function bitmapFromData(data: Uint16Array, nData: number, bitmap: Uint8Array, minNonZero: {
    value: number;
}, maxNonZero: {
    value: number;
}): void;
/**
 * Build forward LUT: value -> compact index (0..n). Returns maxValue (n-1).
 */
export declare function forwardLutFromBitmap(bitmap: Uint8Array, lut: Uint16Array): number;
/**
 * Apply forward LUT: replace data values with compact indices.
 */
export declare function applyLutForward(lut: Uint16Array, data: Uint16Array, nData: number): void;
/**
 * Compress half-float interleaved block using PIZ.
 * Input: rawHalfFloatInterleaved (scanline-interleaved bytes in header channel order: ch0, ch1, ... per pixel)
 */
export declare function compressPizBlock(rawHalfFloatInterleaved: Uint8Array, width: number, blockHeight: number, channels: ExrChannel[]): Uint8Array;
