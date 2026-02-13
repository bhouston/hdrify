/**
 * Mapping between our DisplayColorSpace and HTML Canvas PredefinedColorSpace.
 * Canvas supports 'srgb' and 'display-p3'; rec2020 is not yet in the spec.
 */

import type { DisplayColorSpace } from './colorSpaces.js';

/** Canvas color spaces supported by getContext('2d', { colorSpace }) and ImageData */
export const CANVAS_DISPLAY_COLOR_SPACES = ['srgb', 'display-p3'] as const;

export type CanvasPredefinedColorSpace = (typeof CANVAS_DISPLAY_COLOR_SPACES)[number];

/** Map our DisplayColorSpace to Canvas PredefinedColorSpace where supported */
const DISPLAY_TO_CANVAS: Partial<Record<DisplayColorSpace, CanvasPredefinedColorSpace>> = {
  'display-srgb': 'srgb',
  'display-p3': 'display-p3',
  // display-rec2020: not in PredefinedColorSpace yet
};

/**
 * Get Canvas PredefinedColorSpace for a DisplayColorSpace.
 * Returns undefined for display-rec2020 (Canvas does not yet support it).
 */
export function getCanvasColorSpaceForDisplay(display: DisplayColorSpace): CanvasPredefinedColorSpace | undefined {
  return DISPLAY_TO_CANVAS[display];
}
