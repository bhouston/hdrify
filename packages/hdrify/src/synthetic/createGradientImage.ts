/**
 * Create a synthetic gradient image for tonemapping continuity tests.
 *
 * Supports linear gradients (horizontal, vertical, diagonal) with configurable
 * min/max values. Useful for testing that tone mapping preserves continuity.
 */

import type { FloatImageData } from '../floatImage.js';

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
 * Create a synthetic FloatImageData with a linear gradient.
 */
export function createGradientImage(options: CreateGradientImageOptions): FloatImageData {
  const { width, height, mode, min, max, channel = 'rgb' } = options;

  const data = new Float32Array(width * height * 4);
  const range = max - min;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let t: number;
      if (mode === 'horizontal') {
        t = width > 1 ? x / (width - 1) : 0;
      } else if (mode === 'vertical') {
        t = height > 1 ? y / (height - 1) : 0;
      } else {
        const denom = width - 1 + height - 1;
        t = denom > 0 ? (x + y) / denom : 0;
      }

      const value = min + t * range;

      const pixelIndex = (y * width + x) * 4;
      const r = channel === 'rgb' || channel === 'r' ? value : 0;
      const g = channel === 'rgb' || channel === 'g' ? value : 0;
      const b = channel === 'rgb' || channel === 'b' ? value : 0;
      data[pixelIndex] = r;
      data[pixelIndex + 1] = g;
      data[pixelIndex + 2] = b;
      data[pixelIndex + 3] = 1.0;
    }
  }

  return {
    width,
    height,
    data,
  };
}
