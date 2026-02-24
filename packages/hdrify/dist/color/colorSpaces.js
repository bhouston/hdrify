/**
 * Linear and display-referred color space types.
 * Linear spaces have no transfer function; display spaces have gamma/curve encoding.
 */
import { CHROMATICITIES_P3, CHROMATICITIES_REC709, CHROMATICITIES_REC2020 } from './chromaticities.js';
/** All linear color spaces */
export const LINEAR_COLOR_SPACES = [
    'linear-rec709',
    'linear-p3',
    'linear-rec2020',
];
/** All display color spaces */
export const DISPLAY_COLOR_SPACES = [
    'display-srgb',
    'display-p3',
    'display-rec2020',
];
/** Chromaticities for each linear color space (for matrix building). */
export const LINEAR_TO_CHROMATICITIES = {
    'linear-rec709': CHROMATICITIES_REC709,
    'linear-p3': CHROMATICITIES_P3,
    'linear-rec2020': CHROMATICITIES_REC2020,
};
/** Chromaticities for each display color space. */
export const DISPLAY_TO_CHROMATICITIES = {
    'display-srgb': CHROMATICITIES_REC709,
    'display-p3': CHROMATICITIES_P3,
    'display-rec2020': CHROMATICITIES_REC2020,
};
/** Display color space that corresponds to each linear space. */
export const LINEAR_TO_DISPLAY = {
    'linear-rec709': 'display-srgb',
    'linear-p3': 'display-p3',
    'linear-rec2020': 'display-rec2020',
};
/** Linear color space that corresponds to each display space. */
export const DISPLAY_TO_LINEAR = {
    'display-srgb': 'linear-rec709',
    'display-p3': 'linear-p3',
    'display-rec2020': 'linear-rec2020',
};
/** Tolerance for matching chromaticities (CIE xy) */
const CHROMATICITY_TOLERANCE = 0.01;
function chromaticitiesMatch(a, b) {
    return Math.abs(a.x - b.x) <= CHROMATICITY_TOLERANCE && Math.abs(a.y - b.y) <= CHROMATICITY_TOLERANCE;
}
/**
 * Map chromaticities to LinearColorSpace if they match a known space.
 * Returns undefined if no match (caller should default to linear-rec709).
 */
export function chromaticitiesToLinearColorSpace(ch) {
    const red = { x: ch.redX, y: ch.redY };
    const green = { x: ch.greenX, y: ch.greenY };
    const blue = { x: ch.blueX, y: ch.blueY };
    const white = { x: ch.whiteX, y: ch.whiteY };
    for (const space of LINEAR_COLOR_SPACES) {
        const known = LINEAR_TO_CHROMATICITIES[space];
        if (chromaticitiesMatch(red, { x: known.redX, y: known.redY }) &&
            chromaticitiesMatch(green, { x: known.greenX, y: known.greenY }) &&
            chromaticitiesMatch(blue, { x: known.blueX, y: known.blueY }) &&
            chromaticitiesMatch(white, { x: known.whiteX, y: known.whiteY })) {
            return space;
        }
    }
    return;
}
//# sourceMappingURL=colorSpaces.js.map