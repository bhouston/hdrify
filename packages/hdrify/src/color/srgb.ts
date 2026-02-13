/**
 * sRGB ↔ linear transfer functions (IEC 61966-2-1).
 *
 * All functions operate on single-channel values in the range [0, 1].
 * Callers must normalize from byte values first (e.g. byte/255) to avoid
 * losing precision; do not apply these to raw 0–255 values.
 */

/** sRGB linear segment threshold (≈0.04045 in sRGB space) */
const SRGB_LINEAR_KNEELOW = 0.04045;
/** Reciprocal of 12.92 (avoid division in hot path) */
const SRGB_LINEAR_SCALE_LOW = 1 / 12.92;
/** 1/1.055 — display segment scale (avoid division in hot path) */
const SRGB_DISPLAY_SCALE = 1 / 1.055;
/** 1/2.4 — gamma exponent (avoid division in hot path) */
const SRGB_GAMMA = 1 / 2.4;
/** Linear segment threshold for linear→sRGB (≈0.0031308 in linear space) */
const LINEAR_SRGB_KNEELOW = 0.0031308;

/**
 * Convert a single sRGB-encoded channel value to linear light.
 * Input and output are in [0, 1]. Normalize from bytes (e.g. byte/255) before calling.
 *
 * @param x - sRGB value in [0, 1]
 * @returns Linear value in [0, 1]
 */
export function sRGBToLinear(x: number): number {
  if (x <= SRGB_LINEAR_KNEELOW) {
    return x * SRGB_LINEAR_SCALE_LOW;
  }
  return ((x + 0.055) * SRGB_DISPLAY_SCALE) ** 2.4;
}

/**
 * Convert a single linear channel value to sRGB-encoded.
 * Input and output are in [0, 1]. Apply after any linear math; multiply by 255 for bytes if needed.
 *
 * @param x - Linear value in [0, 1]
 * @returns sRGB value in [0, 1]
 */
export function linearTosRGB(x: number): number {
  if (x <= LINEAR_SRGB_KNEELOW) {
    return x * 12.92;
  }
  return 1.055 * x ** SRGB_GAMMA - 0.055;
}
