/**
 * Color space conversion utilities.
 * convertFloat32ToLinearColorSpace returns original data when no conversion needed.
 */
import type { HdrifyImage } from '../hdrifyImage.js';
import type { DisplayColorSpace, LinearColorSpace } from './colorSpaces.js';
/**
 * Convert Float32Array RGBA pixel data from one linear color space to another.
 * If from === to, returns the original data without copying.
 * Otherwise creates a new Float32Array (does not mutate input).
 *
 * @param data - RGBA Float32Array
 * @param width - Image width
 * @param height - Image height
 * @param from - Source linear color space
 * @param to - Target linear color space
 * @returns Original data if no conversion; otherwise new Float32Array with converted pixels
 */
export declare function convertFloat32ToLinearColorSpace(data: Float32Array, _width: number, _height: number, from: LinearColorSpace, to: LinearColorSpace): Float32Array;
/**
 * Convert HdrifyImage to a different linear color space.
 * Returns a new image with converted data.
 */
export declare function convertLinearColorSpace(image: HdrifyImage, to: LinearColorSpace): HdrifyImage;
/**
 * Convert linear HdrifyImage to display-referred for a given display space.
 * Converts primaries to match display space if needed, then applies transfer function.
 * Returns new image with display-encoded data in Float32Array (values 0-1).
 */
export declare function convertLinearToDisplay(image: HdrifyImage, to: DisplayColorSpace): HdrifyImage & {
    displayColorSpace: DisplayColorSpace;
};
/**
 * Convert display-referred Float32Array to linear HdrifyImage.
 * Primaries are determined by the display space.
 */
export declare function convertDisplayToLinear(data: Float32Array, width: number, height: number, from: DisplayColorSpace, linearColorSpace: LinearColorSpace): HdrifyImage;
