/**
 * Create a synthetic gradient image for tonemapping continuity tests.
 *
 * Supports linear gradients (horizontal, vertical, diagonal) with configurable
 * min/max values. Useful for testing that tone mapping preserves continuity.
 */
import type { HdrifyImage } from '../hdrifyImage.js';
export type GradientMode = 'horizontal' | 'vertical' | 'diagonal';
export type GradientChannel = 'rgb' | 'r' | 'g' | 'b';
export interface CreateGradientImageOptions {
    width: number;
    height: number;
    /** Gradient direction */
    mode: GradientMode;
    /** Minimum value (e.g. 0 for 0→1, -0.1 for zero-crossing) */
    min: number;
    /** Maximum value (e.g. 1, 10) */
    max: number;
    /** Which channel(s) to vary: rgb = gray ramp, r/g/b = single channel */
    channel?: GradientChannel;
}
/**
 * Create a synthetic HdrifyImage with a linear gradient.
 */
export declare function createGradientImage(options: CreateGradientImageOptions): HdrifyImage;
