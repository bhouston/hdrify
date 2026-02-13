/**
 * RGB ↔ XYZ matrix conversion from chromaticities (Bruce Lindbloom method).
 * Converts linear RGB between color spaces via XYZ as intermediate.
 */

import type { Chromaticities } from './chromaticities.js';

/** 3×3 row-major matrix: M[row][col] */
export type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

/**
 * Build RGB → XYZ matrix from chromaticities.
 * Assumes linear RGB in [0, 1] and D65-like white point.
 * See http://www.brucelindbloom.com/Eqn_RGB_XYZ_Matrix.html
 */
export function chromaticitiesToRgbXyzMatrix(ch: Chromaticities): Mat3 {
  const xr = ch.redX / ch.redY;
  const yr = 1;
  const zr = (1 - ch.redX - ch.redY) / ch.redY;

  const xg = ch.greenX / ch.greenY;
  const yg = 1;
  const zg = (1 - ch.greenX - ch.greenY) / ch.greenY;

  const xb = ch.blueX / ch.blueY;
  const yb = 1;
  const zb = (1 - ch.blueX - ch.blueY) / ch.blueY;

  const xw = ch.whiteX / ch.whiteY;
  const yw = 1;
  const zw = (1 - ch.whiteX - ch.whiteY) / ch.whiteY;

  const det = xr * (yg * zb - yb * zg) - xg * (yr * zb - yb * zr) + xb * (yr * zg - yg * zr);
  const sr = (xw * (yg * zb - yb * zg) - xg * (yw * zb - yb * zw) + xb * (yw * zg - yg * zw)) / det;
  const sg = (xr * (yw * zb - yb * zw) - xw * (yr * zb - yb * zr) + xb * (yr * zw - yw * zr)) / det;
  const sb = (xr * (yg * zw - yw * zg) - xg * (yr * zw - yw * zr) + xw * (yr * zg - yg * zr)) / det;

  return [
    [sr * xr, sg * xg, sb * xb],
    [sr * yr, sg * yg, sb * yb],
    [sr * zr, sg * zg, sb * zb],
  ];
}

/**
 * Build matrix to convert linear RGB from space A to space B.
 * RGB_B = M * RGB_A (apply as matrix-vector multiply).
 */
export function buildLinearToLinearMatrix(from: Chromaticities, to: Chromaticities): Mat3 {
  const mFrom = chromaticitiesToRgbXyzMatrix(from);
  const mTo = chromaticitiesToRgbXyzMatrix(to);
  const mToInv = invert3(mTo);
  return multiply3(mToInv, mFrom);
}

function multiply3(a: Mat3, b: Mat3): Mat3 {
  return [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1],
      a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][1],
      a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2],
    ],
    [
      a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0],
      a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][1],
      a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2],
    ],
  ];
}

function invert3(m: Mat3): Mat3 {
  const a = m[0][0];
  const b = m[0][1];
  const c = m[0][2];
  const d = m[1][0];
  const e = m[1][1];
  const f = m[1][2];
  const g = m[2][0];
  const h = m[2][1];
  const i = m[2][2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const invDet = 1 / det;
  return [
    [(e * i - f * h) * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet],
    [(f * g - d * i) * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet],
    [(d * h - e * g) * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet],
  ];
}

/**
 * Apply 3×3 matrix to RGB vector. Returns new [r, g, b].
 */
export function applyMatrix3(r: number, g: number, b: number, m: Mat3): [number, number, number] {
  return [
    m[0][0] * r + m[0][1] * g + m[0][2] * b,
    m[1][0] * r + m[1][1] * g + m[1][2] * b,
    m[2][0] * r + m[2][1] * g + m[2][2] * b,
  ];
}

/**
 * Convert linear RGB in-place in a Float32Array (RGBA layout).
 * Mutates the buffer; does not create a copy.
 */
export function applyMatrix3ToFloat32Array(data: Float32Array, matrix: Mat3): void {
  for (let i = 0; i < data.length; i += 4) {
    // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by data.length loop
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by data.length loop
    const [r2, g2, b2] = applyMatrix3(r, g, b, matrix);
    data[i] = r2;
    data[i + 1] = g2;
    data[i + 2] = b2;
  }
}
