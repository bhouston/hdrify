/**
 * sRGB ↔ linear transfer functions (IEC 61966-2-1).
 *
 * All functions operate on single-channel values in the range [0, 1].
 * Callers must normalize from byte values first (e.g. byte/255) to avoid
 * losing precision; do not apply these to raw 0–255 values.
 */
/**
 * Convert a single sRGB-encoded channel value to linear light.
 * Input and output are in [0, 1]. Normalize from bytes (e.g. byte/255) before calling.
 *
 * @param x - sRGB value in [0, 1]
 * @returns Linear value in [0, 1]
 */
export declare function sRGBToLinear(x: number): number;
/**
 * Convert a single linear channel value to sRGB-encoded.
 * Input and output are in [0, 1]. Apply after any linear math; multiply by 255 for bytes if needed.
 *
 * @param x - Linear value in [0, 1]
 * @returns sRGB value in [0, 1]
 */
export declare function linearTosRGB(x: number): number;
