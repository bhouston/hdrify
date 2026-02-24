/**
 * CIE xy chromaticity to XYZ and linear RGB conversion.
 * Used for generating CIE 1931 chromaticity diagram images.
 */
import type { Chromaticities } from './chromaticities.js';
/**
 * Convert CIE xyY to XYZ tristimulus values.
 * xyY: x,y = chromaticity, Y = luminance.
 * When y (chromaticity) < ε, returns black to avoid division by zero.
 */
export declare function xyYToXyz(x: number, y: number, Y: number): {
    x: number;
    y: number;
    z: number;
};
/**
 * Convert CIE XYZ to linear RGB using the given chromaticities (target RGB space).
 */
export declare function xyzToLinearRgb(x: number, y: number, z: number, chromaticities: Chromaticities): {
    r: number;
    g: number;
    b: number;
};
/**
 * Convert CIE xy chromaticity to linear RGB.
 * Uses Y=1 for luminance by default (standard flat diagram).
 */
export declare function xyToLinearRgb(x: number, y: number, chromaticities: Chromaticities, luminance?: number): {
    r: number;
    g: number;
    b: number;
};
