/**
 * RGB ↔ XYZ matrix conversion from chromaticities (Bruce Lindbloom method).
 * Converts linear RGB between color spaces via XYZ as intermediate.
 * Precomputed linear-to-linear matrices are built once at module load.
 */

import type { Chromaticities } from './chromaticities.js';
import type { LinearColorSpace } from './colorSpaces.js';
import { LINEAR_TO_CHROMATICITIES } from './colorSpaces.js';

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

/** Flatten 3×3 row-major matrix to number[] [m00,m01,m02,m10,m11,m12,m20,m21,m22]. */
export function mat3ToArray(m: Mat3): number[] {
  return [m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2]];
}

/**
 * Apply 3×3 matrix to RGB vector. Writes result to output.
 * Matrix: 9 elements row-major. Input/output: 3 elements each (Float32Array or number[]), or use offsets for strided data.
 */
export function applyMatrix3(
  matrix: ArrayLike<number>,
  input: ArrayLike<number>,
  output: ArrayLike<number>,
  inputOffset = 0,
  outputOffset = 0,
): void {
  // biome-ignore-start lint/style/noNonNullAssertion: caller guarantees valid inputOffset
  const r = input[inputOffset]!;
  const g = input[inputOffset + 1]!;
  const b = input[inputOffset + 2]!;
  // biome-ignore-end lint/style/noNonNullAssertion: caller guarantees valid inputOffset
  output[outputOffset] = matrix[0] * r + matrix[1] * g + matrix[2] * b;
  output[outputOffset + 1] = matrix[3] * r + matrix[4] * g + matrix[5] * b;
  output[outputOffset + 2] = matrix[6] * r + matrix[7] * g + matrix[8] * b;
}

/**
 * Convert linear RGB in-place in a Float32Array (RGBA layout).
 * Mutates the buffer; does not create a copy.
 */
export function applyMatrix3ToFloat32Array(data: Float32Array, matrix: Mat3): void {
  const m = mat3ToArray(matrix);
  for (let i = 0; i < data.length; i += 4) {
    applyMatrix3(m, data, data, i, i);
  }
}

// --- Precomputed linear-to-linear matrices (built once at load) ---

const ch709 = LINEAR_TO_CHROMATICITIES['linear-rec709'];
const chP3 = LINEAR_TO_CHROMATICITIES['linear-p3'];
const ch2020 = LINEAR_TO_CHROMATICITIES['linear-rec2020'];

/** Linear Rec.709 → Linear P3 */
export const LINEAR_REC709_TO_LINEAR_P3: Mat3 = buildLinearToLinearMatrix(ch709, chP3);
/** Linear Rec.709 → Linear Rec.2020 */
export const LINEAR_REC709_TO_LINEAR_REC2020: Mat3 = buildLinearToLinearMatrix(ch709, ch2020);
/** Linear P3 → Linear Rec.709 */
export const LINEAR_P3_TO_LINEAR_REC709: Mat3 = buildLinearToLinearMatrix(chP3, ch709);
/** Linear P3 → Linear Rec.2020 */
export const LINEAR_P3_TO_LINEAR_REC2020: Mat3 = buildLinearToLinearMatrix(chP3, ch2020);
/** Linear Rec.2020 → Linear Rec.709 */
export const LINEAR_REC2020_TO_LINEAR_REC709: Mat3 = buildLinearToLinearMatrix(ch2020, ch709);
/** Linear Rec.2020 → Linear P3 */
export const LINEAR_REC2020_TO_LINEAR_P3: Mat3 = buildLinearToLinearMatrix(ch2020, chP3);

/** Keys for off-diagonal linear→linear conversion (from !== to). */
type LinearToLinearKey =
  | 'linear-rec709-linear-p3'
  | 'linear-rec709-linear-rec2020'
  | 'linear-p3-linear-rec709'
  | 'linear-p3-linear-rec2020'
  | 'linear-rec2020-linear-rec709'
  | 'linear-rec2020-linear-p3';

const LINEAR_MATRIX_MAP: Record<LinearToLinearKey, Mat3> = {
  'linear-rec709-linear-p3': LINEAR_REC709_TO_LINEAR_P3,
  'linear-rec709-linear-rec2020': LINEAR_REC709_TO_LINEAR_REC2020,
  'linear-p3-linear-rec709': LINEAR_P3_TO_LINEAR_REC709,
  'linear-p3-linear-rec2020': LINEAR_P3_TO_LINEAR_REC2020,
  'linear-rec2020-linear-rec709': LINEAR_REC2020_TO_LINEAR_REC709,
  'linear-rec2020-linear-p3': LINEAR_REC2020_TO_LINEAR_P3,
};

/**
 * Return the precomputed matrix to convert linear RGB from `from` to `to`.
 * Returns null when from === to (identity; caller should skip conversion).
 */
export function getLinearToLinearMatrix(from: LinearColorSpace, to: LinearColorSpace): Mat3 | null {
  if (from === to) return null;
  const key = `${from}-${to}` as LinearToLinearKey;
  return LINEAR_MATRIX_MAP[key];
}
