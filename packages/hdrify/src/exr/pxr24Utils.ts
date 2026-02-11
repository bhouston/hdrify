/**
 * PXR24 (Pixar 24-bit) compression utilities
 * F32<->F24 conversion for lossy float compression
 * Ported from Rust exr crate pxr24.rs
 */

/**
 * Convert 32-bit float to 24-bit representation (lossy).
 * Rounds significand to 15 bits. Handles Inf/NaN.
 */
export function float32ToF24(float: number): number {
  const bits = new Float32Array(1);
  bits[0] = float;
  const x = new Uint32Array(bits.buffer)[0] ?? 0;

  const sign = x & 0x80000000;
  const exponent = x & 0x7f800000;
  const mantissa = x & 0x007fffff;

  let result: number;
  if (exponent === 0x7f800000) {
    if (mantissa !== 0) {
      // NaN: preserve sign and 15 leftmost bits of significand
      const m = mantissa >> 8;
      result = (exponent >> 8) | m | (m === 0 ? 1 : 0);
    } else {
      // Inf
      result = exponent >> 8;
    }
  } else {
    // Finite: round significand to 15 bits
    result = ((exponent | mantissa) + (mantissa & 0x00000080)) >> 8;
    if (result >= 0x7f8000) {
      result = (exponent | mantissa) >> 8;
    }
  }

  return (sign >> 8) | result;
}

/**
 * Convert 24-bit PXR24 value back to 32-bit float.
 * Reverse of float32ToF24: left shift 8 bits, interpret as float32.
 */
export function f24ToFloat32(b0: number, b1: number, b2: number): number {
  const u32 = b0 | (b1 << 8) | (b2 << 16);
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, u32 << 8, true);
  return new DataView(buf).getFloat32(0, true);
}

/**
 * PXR24 byte transposition: [lo0,hi0, lo1,hi1, ...] -> [all_lo][all_hi].
 * Used for OpenEXR PXR24 compression.
 */
export function transposePxr24Bytes(src: Uint8Array, bytesPerSample: number): Uint8Array {
  const totalSamples = src.length / bytesPerSample;
  const out = new Uint8Array(src.length);
  for (let s = 0; s < totalSamples; s++) {
    for (let b = 0; b < bytesPerSample; b++) {
      out[b * totalSamples + s] = src[s * bytesPerSample + b]!;
    }
  }
  return out;
}

/**
 * Undo PXR24 byte transposition: [all_lo][all_hi] -> [lo0,hi0, lo1,hi1, ...].
 */
export function undoPxr24Transposition(src: Uint8Array, bytesPerSample: number): Uint8Array {
  const totalSamples = src.length / bytesPerSample;
  const out = new Uint8Array(src.length);
  for (let s = 0; s < totalSamples; s++) {
    for (let b = 0; b < bytesPerSample; b++) {
      out[s * bytesPerSample + b] = src[b * totalSamples + s]!;
    }
  }
  return out;
}
