/**
 * Create a synthetic circular gradient image using an SDF (signed distance function).
 *
 * For each pixel, the Euclidean (Pythagorean) distance to the top-left corner (0, 0)
 * is computed, normalized by the diagonal length of the image, and used to produce
 * a smooth grayscale gradient from white (at top-left) to black (at bottom-right).
 * Default size is 512×512 like other reference images.
 */

import type { FloatImageData } from '../floatImage.js';

export interface CreateSdfGradientImageOptions {
  width: number;
  height: number;
}

/**
 * Create a synthetic FloatImageData with a smooth circular gradient from top-left.
 * White at (0,0), black at (width-1, height-1); gradient is linear in distance.
 */
export function createSdfGradientImage(options: CreateSdfGradientImageOptions): FloatImageData {
  const { width, height } = options;

  const data = new Float32Array(width * height * 4);

  const maxDist = width > 1 || height > 1 ? Math.sqrt((width - 1) ** 2 + (height - 1) ** 2) : 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.sqrt(x * x + y * y);
      const t = maxDist > 0 ? d / maxDist : 0;
      const intensity = 1 - t;

      const pixelIndex = (y * width + x) * 4;
      data[pixelIndex] = intensity;
      data[pixelIndex + 1] = intensity;
      data[pixelIndex + 2] = intensity;
      data[pixelIndex + 3] = 1.0;
    }
  }

  return {
    width,
    height,
    data,
    linearColorSpace: 'linear-rec709',
  };
}
