/**
 * HDR (Radiance RGBE) file writer
 *
 * Writes HDR files from FloatImageData
 * Implements the Radiance RGBE encoding format
 */

import { ensureNonNegativeFinite, type FloatImageData } from '../floatImage.js';

/**
 * Write an HDR file buffer from FloatImageData
 *
 * @param floatImageData - FloatImageData containing image dimensions and pixel data
 * @returns Uint8Array containing HDR file data
 */
export function writeHdr(floatImageData: FloatImageData): Uint8Array {
  ensureNonNegativeFinite(floatImageData.data);
  const { width, height, data } = floatImageData;

  // Calculate file size: header + pixel data
  // Header: "#?RADIANCE\n# Land of Assets\nFORMAT=32-bit_rle_rgbe\n\n-Y {height} +X {width}\n"
  const header = `#?RADIANCE\n# Land of Assets\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
  const headerBytes = new TextEncoder().encode(header);
  const pixelDataSize = width * height * 4; // RGBE = 4 bytes per pixel
  const fileSize = headerBytes.length + pixelDataSize;

  const buffer = new Uint8Array(fileSize);
  buffer.set(headerBytes, 0);

  // Convert Float32Array RGBA to RGBE format
  let pixelOffset = headerBytes.length;
  for (let i = 0; i < width * height; i++) {
    const dataIndex = i * 4; // RGBA format
    // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by width*height*4 loop
    const r = data[dataIndex]!;
    const g = data[dataIndex + 1]!;
    const b = data[dataIndex + 2]!;
    // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by width*height*4 loop

    // Convert to RGBE
    const { r: re, g: ge, b: be, e } = floatToRGBE(r, g, b);

    buffer[pixelOffset++] = re;
    buffer[pixelOffset++] = ge;
    buffer[pixelOffset++] = be;
    buffer[pixelOffset++] = e;
  }

  return buffer;
}

/**
 * Convert floating point RGB values to RGBE format
 *
 * RGBE format stores high dynamic range values using:
 * - R, G, B: mantissa (8 bits each, 0-255)
 * - E: shared exponent (8 bits, 128-255, representing 2^(E-128))
 *
 * @param r - Red channel value (float)
 * @param g - Green channel value (float)
 * @param b - Blue channel value (float)
 * @returns RGBE values as bytes
 */
function floatToRGBE(r: number, g: number, b: number): { r: number; g: number; b: number; e: number } {
  // Shared exponent: scale is determined by the largest channel so all three mantissas use the same factor
  const max = Math.max(r, g, b);

  if (max < 1e-32) {
    return { r: 0, g: 0, b: 0, e: 0 };
  }

  // Exponent from largest channel so factor >= max and (max/factor)*255 fits in [0,255]
  let exponent = Math.ceil(Math.log2(max)) + 128;
  if (exponent < 128) exponent = 128;
  else if (exponent > 255) exponent = 255;

  let factor = 2 ** (exponent - 128);

  // Mantissas: same scale for R,G,B; decode is (byte+0.5)*factor/255 so encode byte = round(v*255/factor - 0.5)
  const toMantissa = (v: number, f: number) => Math.round((v / f) * 255 - 0.5);

  let re = toMantissa(r, factor);
  let ge = toMantissa(g, factor);
  let be = toMantissa(b, factor);

  // Quantization-aware: if the largest channel's rounded mantissa exceeds 255, bump exponent and recompute
  const maxMantissa = Math.max(re, ge, be);
  if (maxMantissa > 255 && exponent < 255) {
    exponent += 1;
    factor = 2 ** (exponent - 128);
    re = toMantissa(r, factor);
    ge = toMantissa(g, factor);
    be = toMantissa(b, factor);
  }

  return {
    r: Math.max(0, Math.min(255, re)),
    g: Math.max(0, Math.min(255, ge)),
    b: Math.max(0, Math.min(255, be)),
    e: exponent,
  };
}
