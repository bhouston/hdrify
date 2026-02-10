/**
 * HDR (Radiance RGBE) file writer
 *
 * Writes HDR files from FloatImageData
 * Implements the Radiance RGBE encoding format
 */

import type { FloatImageData } from '../floatImage.js';

/**
 * Write an HDR file buffer from FloatImageData
 *
 * @param floatImageData - FloatImageData containing image dimensions and pixel data
 * @returns Uint8Array containing HDR file data
 */
export function writeHdr(floatImageData: FloatImageData): Uint8Array {
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

    const r = data[dataIndex] ?? 0;
    const g = data[dataIndex + 1] ?? 0;
    const b = data[dataIndex + 2] ?? 0;

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
  // Find the maximum of the three values
  const max = Math.max(r, g, b);

  if (max < 1e-32) {
    // All values are essentially zero
    return { r: 0, g: 0, b: 0, e: 0 };
  }

  // Normalize and find exponent
  // We want to represent the value as mantissa * 2^exponent
  // The exponent is stored as E - 128, so E = 128 + exponent
  let exponent = Math.floor(Math.log2(max)) + 128;
  if (exponent < 128) {
    exponent = 128;
  } else if (exponent > 255) {
    exponent = 255;
  }

  // Calculate mantissa (multiply by 2^(128-exponent) and scale to 0-255)
  const factor = 2 ** (exponent - 128);
  const re = Math.floor((r / factor) * 255 + 0.5);
  const ge = Math.floor((g / factor) * 255 + 0.5);
  const be = Math.floor((b / factor) * 255 + 0.5);

  // Clamp to valid range
  return {
    r: Math.max(0, Math.min(255, re)),
    g: Math.max(0, Math.min(255, ge)),
    b: Math.max(0, Math.min(255, be)),
    e: exponent,
  };
}
