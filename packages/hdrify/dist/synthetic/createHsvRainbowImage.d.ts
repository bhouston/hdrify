/**
 * Create a synthetic HSV rainbow image for testing.
 *
 * Layout:
 * - Hue: 0° at top (y=0), 360° at bottom (y=height-1)
 * - Saturation: 0 at left (x=0), 1 at right (x=width-1)
 * - Value: constant per the value parameter (0-1)
 * - Intensity: multiplies RGB output for HDR (SDR -> HDR conversion)
 */
import type { HdrifyImage } from '../hdrifyImage.js';
export interface CreateHsvRainbowImageOptions {
    width: number;
    height: number;
    /** HSV value (0-1), constant for all pixels */
    value: number;
    /** Multiplier for HDR (SDR -> HDR conversion) */
    intensity: number;
}
/**
 * Create a synthetic HdrifyImage with HSV rainbow layout.
 */
export declare function createHsvRainbowImage(options: CreateHsvRainbowImageOptions): HdrifyImage;
