/**
 * Mapping between our DisplayColorSpace and HTML Canvas PredefinedColorSpace.
 * Canvas supports 'srgb' and 'display-p3'; rec2020 is not yet in the spec.
 */
import type { DisplayColorSpace } from './colorSpaces.js';
/** Canvas color spaces supported by getContext('2d', { colorSpace }) and ImageData */
export declare const CANVAS_DISPLAY_COLOR_SPACES: readonly ["srgb", "display-p3"];
export type CanvasPredefinedColorSpace = (typeof CANVAS_DISPLAY_COLOR_SPACES)[number];
/**
 * Get Canvas PredefinedColorSpace for a DisplayColorSpace.
 * Returns undefined for display-rec2020 (Canvas does not yet support it).
 */
export declare function getCanvasColorSpaceForDisplay(display: DisplayColorSpace): CanvasPredefinedColorSpace | undefined;
