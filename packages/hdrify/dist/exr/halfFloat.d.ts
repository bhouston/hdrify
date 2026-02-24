/**
 * Half-precision (16-bit) float encoding and decoding
 */
/**
 * Encode a 32-bit float to half-precision (16-bit) per IEEE 754-2008.
 * Uses OpenEXR-style conversion with rounding (from gamedev.stackexchange).
 */
export declare function encodeFloat16(float32: number): number;
/**
 * Decode a half-precision float (16-bit) to a 32-bit float
 */
export declare function decodeFloat16(uint16: number): number;
