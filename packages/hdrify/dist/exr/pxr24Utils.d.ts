/**
 * PXR24 (Pixar 24-bit) compression utilities
 * F32<->F24 conversion for lossy float compression
 * Ported from Rust exr crate pxr24.rs
 */
/**
 * Convert 32-bit float to 24-bit representation (lossy).
 * Rounds significand to 15 bits. Handles Inf/NaN.
 */
export declare function float32ToF24(float: number): number;
/**
 * Convert 24-bit PXR24 value back to 32-bit float.
 * Reverse of float32ToF24: left shift 8 bits, interpret as float32.
 */
export declare function f24ToFloat32(b0: number, b1: number, b2: number): number;
/**
 * PXR24 byte transposition: [lo0,hi0, lo1,hi1, ...] -> [all_lo][all_hi].
 * Used for OpenEXR PXR24 compression.
 */
export declare function transposePxr24Bytes(src: Uint8Array, bytesPerSample: number): Uint8Array;
/**
 * Undo PXR24 byte transposition: [all_lo][all_hi] -> [lo0,hi0, lo1,hi1, ...].
 */
export declare function undoPxr24Transposition(src: Uint8Array, bytesPerSample: number): Uint8Array;
