/**
 * Create a synthetic CIE 1931 xy chromaticity diagram image.
 * Defined in Rec 2020 linear RGB. Pixel (px, py) maps to CIE xy chromaticity.
 */

import { CHROMATICITIES_REC2020 } from '../color/chromaticities.js';
import { xyToLinearRgb } from '../color/cie.js';
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

/** CIE 1931 xy approximate bounds for the diagram */
const CIE_X_MAX = 0.735;
const CIE_Y_MAX = 0.834;

/**
 * Create a synthetic HdrifyImage with CIE 1931 chromaticity diagram layout.
 * Returns linear Rec 2020 RGB.
 */
export function createCieColorWedgeImage(options: CreateCieColorWedgeImageOptions): HdrifyImage {
  const { width, height, luminance = 1, channel } = options;

  const data = new Float32Array(width * height * 4);

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x = width > 1 ? (px / (width - 1)) * CIE_X_MAX : 0;
      const y = height > 1 ? (1 - py / (height - 1)) * CIE_Y_MAX : CIE_Y_MAX;

      const { r, g, b } = xyToLinearRgb(x, y, CHROMATICITIES_REC2020, luminance);

      const pixelIndex = (py * width + px) * 4;
      if (channel === 'r') {
        data[pixelIndex] = Math.max(0, r);
        data[pixelIndex + 1] = 0;
        data[pixelIndex + 2] = 0;
      } else if (channel === 'g') {
        data[pixelIndex] = 0;
        data[pixelIndex + 1] = Math.max(0, g);
        data[pixelIndex + 2] = 0;
      } else if (channel === 'b') {
        data[pixelIndex] = 0;
        data[pixelIndex + 1] = 0;
        data[pixelIndex + 2] = Math.max(0, b);
      } else {
        data[pixelIndex] = Math.max(0, r);
        data[pixelIndex + 1] = Math.max(0, g);
        data[pixelIndex + 2] = Math.max(0, b);
      }
      data[pixelIndex + 3] = 1.0;
    }
  }

  return {
    width,
    height,
    data,
    linearColorSpace: 'linear-rec2020',
  };
}
