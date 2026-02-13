/**
 * Transfer functions: linear ↔ display-referred.
 * sRGB and Display P3 use the same IEC 61966-2-1 curve.
 * Rec. 2020 display (SDR) uses BT.1886 / 2.4 gamma.
 */

import type { DisplayColorSpace } from './colorSpaces.js';
import { linearTosRGB, sRGBToLinear } from './srgb.js';

/** sRGB linear segment threshold (≈0.04045 in sRGB space) */
const LINEAR_SRGB_KNEELOW = 0.0031308;

/** 1/2.4 — Rec. 2020 gamma exponent (avoid division in hot path) */
const REC2020_GAMMA = 1 / 2.4;
/** 1/12.92 — linear segment scale (avoid division in hot path) */
const REC2020_LINEAR_SCALE = 1 / 12.92;
/** 1/1.055 — display segment scale (avoid division in hot path) */
const REC2020_DISPLAY_SCALE = 1 / 1.055;

/**
 * Rec. 2020 / BT.1886 display: linear to 2.4 gamma.
 * EOTF^-1 for SDR Rec. 2020.
 */
function linearToRec2020Display(x: number): number {
  if (x <= LINEAR_SRGB_KNEELOW) {
    return x * 12.92;
  }
  return 1.055 * x ** REC2020_GAMMA - 0.055;
}

/**
 * Rec. 2020 / BT.1886 display: 2.4 gamma to linear.
 * EOTF for SDR Rec. 2020.
 */
function rec2020DisplayToLinear(x: number): number {
  if (x <= 0.04045) {
    return x * REC2020_LINEAR_SCALE;
  }
  return ((x + 0.055) * REC2020_DISPLAY_SCALE) ** 2.4;
}

/**
 * Convert linear RGB to display-referred.
 * sRGB and Display P3 use the same transfer (IEC 61966-2-1).
 */
export function linearToDisplay(r: number, g: number, b: number, space: DisplayColorSpace): [number, number, number] {
  // biome-ignore lint/nursery/noUnnecessaryConditions: exhaustive switch for DisplayColorSpace
  switch (space) {
    case 'display-srgb':
    case 'display-p3':
      return [linearTosRGB(r), linearTosRGB(g), linearTosRGB(b)];
    case 'display-rec2020':
      return [linearToRec2020Display(r), linearToRec2020Display(g), linearToRec2020Display(b)];
    default: {
      const _: never = space;
      return [r, g, b];
    }
  }
}

/**
 * Convert display-referred RGB to linear.
 */
export function displayToLinear(r: number, g: number, b: number, space: DisplayColorSpace): [number, number, number] {
  // biome-ignore lint/nursery/noUnnecessaryConditions: exhaustive switch for DisplayColorSpace
  switch (space) {
    case 'display-srgb':
    case 'display-p3':
      return [sRGBToLinear(r), sRGBToLinear(g), sRGBToLinear(b)];
    case 'display-rec2020':
      return [rec2020DisplayToLinear(r), rec2020DisplayToLinear(g), rec2020DisplayToLinear(b)];
    default: {
      const _: never = space;
      return [r, g, b];
    }
  }
}
