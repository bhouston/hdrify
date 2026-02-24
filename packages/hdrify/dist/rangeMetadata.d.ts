import type { HdrifyImage } from './hdrifyImage.js';
/**
 * Compute MIN_VALUE, MAX_VALUE, RANGE, and AVG_VALUE from RGB channels in a single pass.
 * Adds these to the returned metadata object.
 */
export declare function addRangeMetadata(image: HdrifyImage): Record<string, unknown>;
