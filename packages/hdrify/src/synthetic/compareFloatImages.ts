/**
 * Compare two FloatImageData images within a tolerance.
 */

import type { FloatImageData } from '../floatImage.js';

export interface CompareFloatImagesOptions {
  /** Relative tolerance as decimal (e.g. 0.01 = 1%) */
  tolerancePercent?: number;
  /** Absolute tolerance for near-zero values */
  toleranceAbsolute?: number;
  /** When set, return structured samples for the first N mismatched pixels */
  includeMismatchSamples?: number;
}

export interface MismatchSample {
  pixelIndex: number;
  x: number;
  y: number;
  expected: [number, number, number, number];
  actual: [number, number, number, number];
}

export interface CompareFloatImagesResult {
  match: boolean;
  maxDiff?: number;
  mismatchedPixels?: number;
  /** Present when includeMismatchSamples is set and there are mismatches */
  mismatchSamples?: MismatchSample[];
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
  const maxSamples = options?.includeMismatchSamples ?? 0;

  if (a.width !== b.width || a.height !== b.height) {
    return { match: false };
  }

  const pixelCount = a.width * a.height;
  const width = a.width;

  let mismatchedPixels = 0;
  let maxDiff = 0;
  const mismatchSamples: MismatchSample[] = [];

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

    // biome-ignore lint/nursery/noUnnecessaryConditions: pixelMismatch set in inner loop when values differ
    if (pixelMismatch) {
      mismatchedPixels++;
      if (maxSamples > 0 && mismatchSamples.length < maxSamples) {
        const x = p % width;
        const y = Math.floor(p / width);
        mismatchSamples.push({
          pixelIndex: p,
          x,
          y,
          expected: [
            a.data[p * 4] ?? 0,
            a.data[p * 4 + 1] ?? 0,
            a.data[p * 4 + 2] ?? 0,
            a.data[p * 4 + 3] ?? 0,
          ],
          actual: [
            b.data[p * 4] ?? 0,
            b.data[p * 4 + 1] ?? 0,
            b.data[p * 4 + 2] ?? 0,
            b.data[p * 4 + 3] ?? 0,
          ],
        });
      }
    }
  }

  const result: CompareFloatImagesResult = {
    match: mismatchedPixels === 0,
    maxDiff,
    mismatchedPixels,
  };
  if (mismatchedPixels > 0 && maxSamples > 0) {
    result.mismatchSamples = mismatchSamples;
  }
  return result;
}
