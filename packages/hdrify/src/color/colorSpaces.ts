/**
 * Linear and display-referred color space types.
 * Linear spaces have no transfer function; display spaces have gamma/curve encoding.
 */

import type { Chromaticities } from './chromaticities.js';
import { CHROMATICITIES_P3, CHROMATICITIES_REC709, CHROMATICITIES_REC2020 } from './chromaticities.js';

/** Linear light color spaces (no transfer function, scene-referred RGB) */
export type LinearColorSpace = 'linear-rec709' | 'linear-p3' | 'linear-rec2020';

/** Display-referred color spaces (with transfer function) */
export type DisplayColorSpace = 'display-srgb' | 'display-p3' | 'display-rec2020';

/** All linear color spaces */
export const LINEAR_COLOR_SPACES: readonly LinearColorSpace[] = [
  'linear-rec709',
  'linear-p3',
  'linear-rec2020',
] as const;

/** All display color spaces */
export const DISPLAY_COLOR_SPACES: readonly DisplayColorSpace[] = [
  'display-srgb',
  'display-p3',
  'display-rec2020',
] as const;

const LINEAR_TO_CHROMATICITIES: Record<LinearColorSpace, Chromaticities> = {
  'linear-rec709': CHROMATICITIES_REC709,
  'linear-p3': CHROMATICITIES_P3,
  'linear-rec2020': CHROMATICITIES_REC2020,
};

const DISPLAY_TO_CHROMATICITIES: Record<DisplayColorSpace, Chromaticities> = {
  'display-srgb': CHROMATICITIES_REC709,
  'display-p3': CHROMATICITIES_P3,
  'display-rec2020': CHROMATICITIES_REC2020,
};

const LINEAR_TO_DISPLAY: Record<LinearColorSpace, DisplayColorSpace> = {
  'linear-rec709': 'display-srgb',
  'linear-p3': 'display-p3',
  'linear-rec2020': 'display-rec2020',
};

const DISPLAY_TO_LINEAR: Record<DisplayColorSpace, LinearColorSpace> = {
  'display-srgb': 'linear-rec709',
  'display-p3': 'linear-p3',
  'display-rec2020': 'linear-rec2020',
};

export function getChromaticitiesForLinear(space: LinearColorSpace): Chromaticities {
  return LINEAR_TO_CHROMATICITIES[space];
}

export function getChromaticitiesForDisplay(space: DisplayColorSpace): Chromaticities {
  return DISPLAY_TO_CHROMATICITIES[space];
}

export function getDisplayColorSpaceForLinear(linear: LinearColorSpace): DisplayColorSpace {
  return LINEAR_TO_DISPLAY[linear];
}

export function getLinearColorSpaceForDisplay(display: DisplayColorSpace): LinearColorSpace {
  return DISPLAY_TO_LINEAR[display];
}

/** Tolerance for matching chromaticities (CIE xy) */
const CHROMATICITY_TOLERANCE = 0.01;

function chromaticitiesMatch(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) <= CHROMATICITY_TOLERANCE && Math.abs(a.y - b.y) <= CHROMATICITY_TOLERANCE;
}

/**
 * Map chromaticities to LinearColorSpace if they match a known space.
 * Returns undefined if no match (caller should default to linear-rec709).
 */
export function chromaticitiesToLinearColorSpace(ch: {
  redX: number;
  redY: number;
  greenX: number;
  greenY: number;
  blueX: number;
  blueY: number;
  whiteX: number;
  whiteY: number;
}): LinearColorSpace | undefined {
  const red = { x: ch.redX, y: ch.redY };
  const green = { x: ch.greenX, y: ch.greenY };
  const blue = { x: ch.blueX, y: ch.blueY };
  const white = { x: ch.whiteX, y: ch.whiteY };

  for (const space of LINEAR_COLOR_SPACES) {
    const known = LINEAR_TO_CHROMATICITIES[space];
    if (
      chromaticitiesMatch(red, { x: known.redX, y: known.redY }) &&
      chromaticitiesMatch(green, { x: known.greenX, y: known.greenY }) &&
      chromaticitiesMatch(blue, { x: known.blueX, y: known.blueY }) &&
      chromaticitiesMatch(white, { x: known.whiteX, y: known.whiteY })
    ) {
      return space;
    }
  }
  return;
}
