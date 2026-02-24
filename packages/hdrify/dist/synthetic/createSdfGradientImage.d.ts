/**
 * Create a synthetic circular gradient image using an SDF (signed distance function).
 *
 * For each pixel, the Euclidean (Pythagorean) distance to the top-left corner (0, 0)
 * is computed, normalized by the diagonal length of the image, and used to produce
 * a smooth grayscale gradient from white (at top-left) to black (at bottom-right).
 * Default size is 512×512 like other reference images.
 */
import type { HdrifyImage } from '../hdrifyImage.js';
export interface CreateSdfGradientImageOptions {
    width: number;
    height: number;
}
/**
 * Create a synthetic HdrifyImage with a smooth circular gradient from top-left.
 * White at (0,0), black at (width-1, height-1); gradient is linear in distance.
 */
export declare function createSdfGradientImage(options: CreateSdfGradientImageOptions): HdrifyImage;
