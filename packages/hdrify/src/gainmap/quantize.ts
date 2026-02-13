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
export function quantizeFloatToU8(x: number): number {
  const clamped = Math.max(0, Math.min(1, x));
  return Math.round(clamped * 255);
}

/**
 * Dequantize a byte 0–255 to float [0, 1].
 * Inverse of quantizeFloatToU8 (up to rounding).
 */
export function dequantizeU8ToFloat(b: number): number {
  return (Math.max(0, Math.min(255, b)) / 255);
}

/**
 * Quantize RGBA float array (0–1) to Uint8ClampedArray (0–255).
 * Length must be multiple of 4.
 */
export function quantizeRgbaFloatToU8(floatRgba: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(floatRgba.length);
  for (let i = 0; i < floatRgba.length; i++) {
    out[i] = quantizeFloatToU8(floatRgba[i] ?? 0);
  }
  return out;
}

/**
 * Dequantize RGBA Uint8Array (0–255) to float [0, 1].
 */
export function dequantizeU8ToRgbaFloat(u8: Uint8Array | Uint8ClampedArray): Float32Array {
  const out = new Float32Array(u8.length);
  for (let i = 0; i < u8.length; i++) {
    out[i] = dequantizeU8ToFloat(u8[i] ?? 0);
  }
  return out;
}
