/**
 * Half-precision (16-bit) float encoding and decoding
 */

const _floatView = new Float32Array(1);
const _int32View = new Int32Array(_floatView.buffer);

/**
 * Encode a 32-bit float to half-precision (16-bit) per IEEE 754-2008.
 * Uses OpenEXR-style conversion with rounding (from gamedev.stackexchange).
 */
export function encodeFloat16(float32: number): number {
  _floatView[0] = float32;
  const x = _int32View[0] ?? 0;

  const bits = (x >> 16) & 0x8000;
  const m = (x >> 12) & 0x07ff;
  const e = (x >> 23) & 0xff;

  if (e < 103) return bits;
  if (e > 142) {
    if (e === 255 && x & 0x007fffff) return bits | 0x7e00; // NaN
    return bits | 0x7c00; // Inf or overflow
  }
  if (e < 113) {
    const mm = m | 0x0800;
    return bits | ((mm >> (114 - e)) + ((mm >> (113 - e)) & 1));
  }
  return bits | ((((e - 112) << 10) | (m >> 1)) + (m & 1));
}

/**
 * Decode a half-precision float (16-bit) to a 32-bit float
 */
export function decodeFloat16(uint16: number): number {
  const sign = (uint16 & 0x8000) >> 15;
  const exponent = (uint16 & 0x7c00) >> 10;
  const mantissa = uint16 & 0x03ff;

  if (exponent === 0) {
    // Denormalized number or zero
    if (mantissa === 0) {
      return sign === 0 ? 0.0 : -0.0;
    }
    return (sign === 0 ? 1 : -1) * 2 ** -14 * (mantissa / 1024);
  }
  if (exponent === 31) {
    // Infinity or NaN
    if (mantissa === 0) {
      return sign === 0 ? Infinity : -Infinity;
    }
    return NaN;
  }

  const value = 2 ** (exponent - 15) * (1 + mantissa / 1024);
  return sign === 0 ? value : -value;
}
