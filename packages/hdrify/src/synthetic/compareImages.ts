/**
 * Compare two HdrifyImage images within a tolerance.
 */

import type { HdrifyImage } from '../hdrifyImage.js';

export interface CompareImagesOptions {
  /** Relative tolerance as decimal (e.g. 0.01 = 1% of reference value) */
  toleranceRelative?: number;
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

export interface CompareImagesResult {
  match: boolean;
  /** Maximum absolute difference over all channels */
  maxAbsoluteDelta?: number;
  /** Maximum relative difference (delta / ref) over all channels where ref > 0 */
  maxRelativeDelta?: number;
  /** Root mean squared error over all channel values */
  rootMeanSquaredError?: number;
  mismatchedPixels?: number;
  /** Present when includeMismatchSamples is set and there are mismatches */
  mismatchSamples?: MismatchSample[];
}

const DEFAULT_TOLERANCE_RELATIVE = 0.01;
const DEFAULT_TOLERANCE_ABSOLUTE = 1e-6;
const SMALL_VALUE_THRESHOLD = 0.01;

/**
 * Compare two HdrifyImage images.
 */
export function compareImages(a: HdrifyImage, b: HdrifyImage, options?: CompareImagesOptions): CompareImagesResult {
  const toleranceRelative = options?.toleranceRelative ?? DEFAULT_TOLERANCE_RELATIVE;
  const toleranceAbsolute = options?.toleranceAbsolute ?? DEFAULT_TOLERANCE_ABSOLUTE;
  const maxSamples = options?.includeMismatchSamples ?? 0;

  if (a.width !== b.width || a.height !== b.height) {
    return { match: false };
  }

  const pixelCount = a.width * a.height;
  const totalValues = pixelCount * 4;
  const width = a.width;

  let mismatchedPixels = 0;
  let maxAbsoluteDelta = 0;
  let maxRelativeDelta = 0;
  let sumSquaredDiff = 0;
  const mismatchSamples: MismatchSample[] = [];

  for (let p = 0; p < pixelCount; p++) {
    let pixelMismatch = false;

    for (let c = 0; c < 4; c++) {
      const i = p * 4 + c;
      // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by pixelCount*4 loop
      const va = a.data[i]!;
      const vb = b.data[i]!;
      // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by pixelCount*4 loop
      const diff = Math.abs(va - vb);
      const delta = va - vb;

      sumSquaredDiff += delta * delta;
      if (diff > maxAbsoluteDelta) {
        maxAbsoluteDelta = diff;
      }

      const ref = Math.max(Math.abs(va), Math.abs(vb));
      if (ref > 0) {
        const rel = diff / ref;
        if (rel > maxRelativeDelta) {
          maxRelativeDelta = rel;
        }
      }

      let withinTolerance: boolean;
      if (ref < SMALL_VALUE_THRESHOLD) {
        withinTolerance = diff <= toleranceAbsolute;
      } else {
        withinTolerance = diff <= ref * toleranceRelative;
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
        // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by pixelCount loop
        mismatchSamples.push({
          pixelIndex: p,
          x,
          y,
          expected: [a.data[p * 4]!, a.data[p * 4 + 1]!, a.data[p * 4 + 2]!, a.data[p * 4 + 3]!],
          actual: [b.data[p * 4]!, b.data[p * 4 + 1]!, b.data[p * 4 + 2]!, b.data[p * 4 + 3]!],
        });
        // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by pixelCount loop
      }
    }
  }

  const rootMeanSquaredError = Math.sqrt(sumSquaredDiff / totalValues);

  const result: CompareImagesResult = {
    match: mismatchedPixels === 0,
    maxAbsoluteDelta,
    maxRelativeDelta,
    rootMeanSquaredError,
    mismatchedPixels,
  };
  if (mismatchedPixels > 0 && maxSamples > 0) {
    result.mismatchSamples = mismatchSamples;
  }
  return result;
}
