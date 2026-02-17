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
 * Convert HSV to RGB (H 0-360°, S 0-1, V 0-1).
 * Returns RGB in 0-1 range.
 */
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  if (s <= 0) {
    return { r: v, g: v, b: v };
  }

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  return {
    r: r + m,
    g: g + m,
    b: b + m,
  };
}

/**
 * Create a synthetic HdrifyImage with HSV rainbow layout.
 */
export function createHsvRainbowImage(options: CreateHsvRainbowImageOptions): HdrifyImage {
  const { width, height, value, intensity } = options;

  const data = new Float32Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const hue = height > 1 ? (y / (height - 1)) * 360 : 0;

    for (let x = 0; x < width; x++) {
      const saturation = width > 1 ? x / (width - 1) : 0;

      const { r, g, b } = hsvToRgb(hue, saturation, value);

      const pixelIndex = (y * width + x) * 4;
      data[pixelIndex] = r * intensity;
      data[pixelIndex + 1] = g * intensity;
      data[pixelIndex + 2] = b * intensity;
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
