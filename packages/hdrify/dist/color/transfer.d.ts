/**
 * Transfer functions: linear ↔ display-referred.
 * sRGB and Display P3 use the same IEC 61966-2-1 curve.
 * Rec. 2020 display (SDR) uses BT.1886 / 2.4 gamma.
 */
import type { DisplayColorSpace } from './colorSpaces.js';
/**
 * Convert linear RGB to display-referred.
 * sRGB and Display P3 use the same transfer (IEC 61966-2-1).
 */
export declare function linearToDisplay(r: number, g: number, b: number, space: DisplayColorSpace): [number, number, number];
/**
 * Convert display-referred RGB to linear.
 */
export declare function displayToLinear(r: number, g: number, b: number, space: DisplayColorSpace): [number, number, number];
