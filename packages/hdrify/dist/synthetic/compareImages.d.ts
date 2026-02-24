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
/**
 * Compare two HdrifyImage images.
 */
export declare function compareImages(a: HdrifyImage, b: HdrifyImage, options?: CompareImagesOptions): CompareImagesResult;
