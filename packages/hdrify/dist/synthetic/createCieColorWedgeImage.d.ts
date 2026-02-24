/**
 * Create a synthetic CIE 1931 xy chromaticity diagram image.
 * Defined in Rec 2020 linear RGB. Pixel (px, py) maps to CIE xy chromaticity.
 */
import type { HdrifyImage } from '../hdrifyImage.js';
export type CieWedgeChannel = 'r' | 'g' | 'b';
export interface CreateCieColorWedgeImageOptions {
    width: number;
    height: number;
    /** Luminance Y for xyY→XYZ conversion (default 1) */
    luminance?: number;
    /** If set, only this channel gets wedge data; other channels are black (for banding diagnostics). */
    channel?: CieWedgeChannel;
}
/**
 * Create a synthetic HdrifyImage with CIE 1931 chromaticity diagram layout.
 * Returns linear Rec 2020 RGB.
 */
export declare function createCieColorWedgeImage(options: CreateCieColorWedgeImageOptions): HdrifyImage;
