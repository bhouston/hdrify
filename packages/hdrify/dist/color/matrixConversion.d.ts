/**
 * RGB ↔ XYZ matrix conversion from chromaticities (Bruce Lindbloom method).
 * Converts linear RGB between color spaces via XYZ as intermediate.
 * Precomputed linear-to-linear matrices are built once at module load.
 */
import type { Chromaticities } from './chromaticities.js';
import type { LinearColorSpace } from './colorSpaces.js';
/** 3×3 row-major matrix: M[row][col] */
export type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];
/**
 * Build RGB → XYZ matrix from chromaticities.
 * Assumes linear RGB in [0, 1] and D65-like white point.
 * See http://www.brucelindbloom.com/Eqn_RGB_XYZ_Matrix.html
 */
export declare function chromaticitiesToRgbXyzMatrix(ch: Chromaticities): Mat3;
/**
 * Build XYZ → RGB matrix from chromaticities.
 * Inverse of chromaticitiesToRgbXyzMatrix; converts CIE XYZ to linear RGB.
 */
export declare function chromaticitiesToXyzRgbMatrix(ch: Chromaticities): Mat3;
/**
 * Build matrix to convert linear RGB from space A to space B.
 * RGB_B = M * RGB_A (apply as matrix-vector multiply).
 */
export declare function buildLinearToLinearMatrix(from: Chromaticities, to: Chromaticities): Mat3;
/** Flatten 3×3 row-major matrix to number[] [m00,m01,m02,m10,m11,m12,m20,m21,m22]. */
export declare function mat3ToArray(m: Mat3): number[];
/** Mutable array-like for output (number[] or Float32Array). */
type WritableArray = number[] | Float32Array;
/**
 * Apply 3×3 matrix to RGB vector. Writes result to output.
 * Matrix: 9 elements row-major. Input/output: 3 elements each (Float32Array or number[]), or use offsets for strided data.
 */
export declare function applyMatrix3(matrix: ArrayLike<number>, input: ArrayLike<number>, output: WritableArray, inputOffset?: number, outputOffset?: number): void;
/**
 * Convert linear RGB in-place in a Float32Array (RGBA layout).
 * Mutates the buffer; does not create a copy.
 */
export declare function applyMatrix3ToFloat32Array(data: Float32Array, matrix: Mat3): void;
/** Linear Rec.709 → Linear P3 */
export declare const LINEAR_REC709_TO_LINEAR_P3: Mat3;
/** Linear Rec.709 → Linear Rec.2020 */
export declare const LINEAR_REC709_TO_LINEAR_REC2020: Mat3;
/** Linear P3 → Linear Rec.709 */
export declare const LINEAR_P3_TO_LINEAR_REC709: Mat3;
/** Linear P3 → Linear Rec.2020 */
export declare const LINEAR_P3_TO_LINEAR_REC2020: Mat3;
/** Linear Rec.2020 → Linear Rec.709 */
export declare const LINEAR_REC2020_TO_LINEAR_REC709: Mat3;
/** Linear Rec.2020 → Linear P3 */
export declare const LINEAR_REC2020_TO_LINEAR_P3: Mat3;
/**
 * Return the precomputed matrix to convert linear RGB from `from` to `to`.
 * Returns null when from === to (identity; caller should skip conversion).
 */
export declare function getLinearToLinearMatrix(from: LinearColorSpace, to: LinearColorSpace): Mat3 | null;
export {};
