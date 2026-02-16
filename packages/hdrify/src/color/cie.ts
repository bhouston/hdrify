/**
 * CIE xy chromaticity to XYZ and linear RGB conversion.
 * Used for generating CIE 1931 chromaticity diagram images.
 */

import type { Chromaticities } from './chromaticities.js';
import { applyMatrix3, chromaticitiesToXyzRgbMatrix, mat3ToArray } from './matrixConversion.js';

const Y_EPSILON = 1e-6;

/**
 * Convert CIE xyY to XYZ tristimulus values.
 * xyY: x,y = chromaticity, Y = luminance.
 * When y (chromaticity) < ε, returns black to avoid division by zero.
 */
export function xyYToXyz(x: number, y: number, Y: number): { x: number; y: number; z: number } {
  if (y < Y_EPSILON) {
    return { x: 0, y: 0, z: 0 };
  }
  const X = (x / y) * Y;
  const Z = ((1 - x - y) / y) * Y;
  return { x: X, y: Y, z: Z };
}

/**
 * Convert CIE XYZ to linear RGB using the given chromaticities (target RGB space).
 */
export function xyzToLinearRgb(
  x: number,
  y: number,
  z: number,
  chromaticities: Chromaticities,
): { r: number; g: number; b: number } {
  const m = chromaticitiesToXyzRgbMatrix(chromaticities);
  const xyz = [x, y, z];
  const rgb: number[] = [0, 0, 0];
  applyMatrix3(mat3ToArray(m), xyz, rgb, 0, 0);
  return { r: rgb[0] ?? 0, g: rgb[1] ?? 0, b: rgb[2] ?? 0 };
}

/**
 * Convert CIE xy chromaticity to linear RGB.
 * Uses Y=1 for luminance by default (standard flat diagram).
 */
export function xyToLinearRgb(
  x: number,
  y: number,
  chromaticities: Chromaticities,
  luminance = 1,
): { r: number; g: number; b: number } {
  const { x: X, y: Y, z: Z } = xyYToXyz(x, y, luminance);
  return xyzToLinearRgb(X, Y, Z, chromaticities);
}
