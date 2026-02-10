/**
 * Floating point image data structure used as an intermediate format
 * for converting between HDR and EXR formats.
 *
 * This format enables format-agnostic processing and ensures consistent
 * data structure across different environment map formats.
 */
export interface FloatImageData {
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** RGBA pixel data as Float32Array: [R, G, B, A, R, G, B, A, ...] */
  data: Float32Array;
  /** Header metadata from source file (e.g. FORMAT, EXPOSURE, GAMMA for HDR; displayWindow, dataWindow, channels, compression for EXR) */
  metadata?: Record<string, unknown>;
}
