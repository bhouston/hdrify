/**
 * CIE xy chromaticity to XYZ and linear RGB conversion.
 * Used for generating CIE 1931 chromaticity diagram images.
 */
import { applyMatrix3, chromaticitiesToXyzRgbMatrix, mat3ToArray } from './matrixConversion.js';
const Y_EPSILON = 1e-6;
/**
 * Convert CIE xyY to XYZ tristimulus values.
 * xyY: x,y = chromaticity, Y = luminance.
 * When y (chromaticity) < ε, returns black to avoid division by zero.
 */
export function xyYToXyz(x, y, Y) {
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
export function xyzToLinearRgb(x, y, z, chromaticities) {
    const m = chromaticitiesToXyzRgbMatrix(chromaticities);
    const xyz = [x, y, z];
    const rgb = [0, 0, 0];
    applyMatrix3(mat3ToArray(m), xyz, rgb, 0, 0);
    return { r: rgb[0] ?? 0, g: rgb[1] ?? 0, b: rgb[2] ?? 0 };
}
/**
 * Convert CIE xy chromaticity to linear RGB.
 * Uses Y=1 for luminance by default (standard flat diagram).
 */
export function xyToLinearRgb(x, y, chromaticities, luminance = 1) {
    const { x: X, y: Y, z: Z } = xyYToXyz(x, y, luminance);
    return xyzToLinearRgb(X, Y, Z, chromaticities);
}
//# sourceMappingURL=cie.js.map