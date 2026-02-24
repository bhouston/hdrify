/**
 * Linear and display-referred color space types.
 * Linear spaces have no transfer function; display spaces have gamma/curve encoding.
 */
import type { Chromaticities } from './chromaticities.js';
/** Linear light color spaces (no transfer function, scene-referred RGB) */
export type LinearColorSpace = 'linear-rec709' | 'linear-p3' | 'linear-rec2020';
/** Display-referred color spaces (with transfer function) */
export type DisplayColorSpace = 'display-srgb' | 'display-p3' | 'display-rec2020';
/** All linear color spaces */
export declare const LINEAR_COLOR_SPACES: readonly LinearColorSpace[];
/** All display color spaces */
export declare const DISPLAY_COLOR_SPACES: readonly DisplayColorSpace[];
/** Chromaticities for each linear color space (for matrix building). */
export declare const LINEAR_TO_CHROMATICITIES: Record<LinearColorSpace, Chromaticities>;
/** Chromaticities for each display color space. */
export declare const DISPLAY_TO_CHROMATICITIES: Record<DisplayColorSpace, Chromaticities>;
/** Display color space that corresponds to each linear space. */
export declare const LINEAR_TO_DISPLAY: Record<LinearColorSpace, DisplayColorSpace>;
/** Linear color space that corresponds to each display space. */
export declare const DISPLAY_TO_LINEAR: Record<DisplayColorSpace, LinearColorSpace>;
/**
 * Map chromaticities to LinearColorSpace if they match a known space.
 * Returns undefined if no match (caller should default to linear-rec709).
 */
export declare function chromaticitiesToLinearColorSpace(ch: {
    redX: number;
    redY: number;
    greenX: number;
    greenY: number;
    blueX: number;
    blueY: number;
    whiteX: number;
    whiteY: number;
}): LinearColorSpace | undefined;
