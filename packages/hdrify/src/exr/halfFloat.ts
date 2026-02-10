/**
 * Half-precision (16-bit) float decoding
 */

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
