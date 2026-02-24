/**
 * Quantize float [0,1] to 8-bit [0,255] and back.
 * Used to isolate quantization error in gain map encode/decode tests.
 *
 * Convention: round to nearest integer; values outside [0,1] are clamped before rounding.
 * Max error when dequantizing is 0.5/255 ≈ 0.00196.
 */
/**
 * Quantize a float in [0, 1] to 0–255 using round-to-nearest.
 * Values are clamped to [0, 1] before rounding.
 */
export declare function quantizeFloatToU8(x: number): number;
/**
 * Dequantize a byte 0–255 to float [0, 1].
 * Inverse of quantizeFloatToU8 (up to rounding).
 */
export declare function dequantizeU8ToFloat(b: number): number;
/**
 * Quantize RGBA float array (0–1) to Uint8ClampedArray (0–255).
 * Length must be multiple of 4.
 */
export declare function quantizeRgbaFloatToU8(floatRgba: Float32Array): Uint8ClampedArray;
/**
 * Dequantize RGBA Uint8Array (0–255) to float [0, 1].
 */
export declare function dequantizeU8ToRgbaFloat(u8: Uint8Array | Uint8ClampedArray): Float32Array;
