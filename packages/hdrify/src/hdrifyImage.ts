import type { LinearColorSpace } from './color/colorSpaces.js';

/**
 * Floating point image data structure used as an intermediate format
 * for converting between HDR and EXR formats.
 *
 * This format enables format-agnostic processing and ensures consistent
 * data structure across different environment map formats.
 */
export interface HdrifyImage {
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** RGBA pixel data as Float32Array: [R, G, B, A, R, G, B, A, ...] */
  data: Float32Array;
  /** Linear color space (primaries) of the RGB data */
  linearColorSpace: LinearColorSpace;
  /** Header metadata from source file (e.g. FORMAT, EXPOSURE, GAMMA for HDR; displayWindow, dataWindow, channels, compression for EXR) */
  metadata?: Record<string, unknown>;
}

/**
 * Sanitize float buffer in-place: set any negative or non-finite value to 0.
 * Used after loading and before saving/encoding so pipelines can assume non-negative finite data.
 *
 * @param data - Float32Array to mutate
 */
export function ensureNonNegativeFinite(data: Float32Array): void {
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v === undefined || v < 0 || !Number.isFinite(v)) data[i] = 0;
  }
}
