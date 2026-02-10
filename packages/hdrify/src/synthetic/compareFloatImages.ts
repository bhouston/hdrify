/**
 * Compare two FloatImageData images within a tolerance.
 */

import type { FloatImageData } from '../floatImage.js';

export interface CompareFloatImagesOptions {
  /** Relative tolerance as decimal (e.g. 0.01 = 1%) */
  tolerancePercent?: number;
  /** Absolute tolerance for near-zero values */
  toleranceAbsolute?: number;
}

export interface CompareFloatImagesResult {
  match: boolean;
  maxDiff?: number;
  mismatchedPixels?: number;
}

const DEFAULT_TOLERANCE_PERCENT = 0.01;
const DEFAULT_TOLERANCE_ABSOLUTE = 1e-6;
const SMALL_VALUE_THRESHOLD = 0.01;

/**
 * Compare two FloatImageData images.
 */
export function compareFloatImages(
  a: FloatImageData,
  b: FloatImageData,
  options?: CompareFloatImagesOptions,
): CompareFloatImagesResult {
  const tolerancePercent = options?.tolerancePercent ?? DEFAULT_TOLERANCE_PERCENT;
  const toleranceAbsolute = options?.toleranceAbsolute ?? DEFAULT_TOLERANCE_ABSOLUTE;

  if (a.width !== b.width || a.height !== b.height) {
    return { match: false };
  }

  const pixelCount = a.width * a.height;

  let mismatchedPixels = 0;
  let maxDiff = 0;

  for (let p = 0; p < pixelCount; p++) {
    let pixelMismatch = false;

    for (let c = 0; c < 4; c++) {
      const i = p * 4 + c;
      const va = a.data[i] ?? 0;
      const vb = b.data[i] ?? 0;
      const diff = Math.abs(va - vb);

      if (diff > maxDiff) {
        maxDiff = diff;
      }

      const ref = Math.max(Math.abs(va), Math.abs(vb));

      let withinTolerance: boolean;
      if (ref < SMALL_VALUE_THRESHOLD) {
        withinTolerance = diff <= toleranceAbsolute;
      } else {
        withinTolerance = diff <= ref * tolerancePercent;
      }

      if (!withinTolerance) {
        pixelMismatch = true;
      }
    }

    if (pixelMismatch) {
      mismatchedPixels++;
    }
  }

  return {
    match: mismatchedPixels === 0,
    maxDiff,
    mismatchedPixels,
  };
}
