/**
 * Gain map metadata - Adobe/Ultra HDR spec compliant.
 * Values in log2 space where applicable.
 */
export interface GainMapMetadata {
  gamma: [number, number, number];
  hdrCapacityMin: number;
  hdrCapacityMax: number;
  offsetSdr: [number, number, number];
  offsetHdr: [number, number, number];
  gainMapMin: [number, number, number];
  gainMapMax: [number, number, number];
}

export interface GainMapMetadataExtended extends GainMapMetadata {
  version: string;
  maxContentBoost: number;
  minContentBoost: number;
}

import type { ToneMappingType } from '../tonemapping/types.js';

export interface GainMapEncodingOptions {
  /** Maximum content boost (HDR/SDR ratio). Default: max of HDR RGB. */
  maxContentBoost?: number;
  /** Minimum content boost. Default: 1 */
  minContentBoost?: number;
  /** Offset for SDR values. Default: [1/64, 1/64, 1/64] */
  offsetSdr?: [number, number, number];
  /** Offset for HDR values. Default: [1/64, 1/64, 1/64] */
  offsetHdr?: [number, number, number];
  /** Gamma for gain map encoding. Default: [1, 1, 1] */
  gamma?: [number, number, number];
  /** Exposure for SDR tone mapping. Default: 1 */
  exposure?: number;
  /** Tone mapping: 'aces' (default) or 'reinhard' */
  toneMapping?: ToneMappingType;
  /** When re-encoding a decoded gain-map image, pass its metadata so the same gain range is used and round-trip drift is minimized. */
  reuseMetadata?: GainMapMetadata;
}

export interface EncodingResult {
  /** SDR image as RGBA Uint8ClampedArray, 0-255 */
  sdr: Uint8ClampedArray;
  /** Gain map as RGBA Uint8ClampedArray, 0-255 */
  gainMap: Uint8ClampedArray;
  /** Image dimensions */
  width: number;
  height: number;
  /** Gain map metadata for decoding */
  metadata: GainMapMetadata;
}

/**
 * Float encoding result (no quantization). For testing and incremental encode/decode.
 * Decode does not need to know the tone mapper: the gain map stores the ratio
 * (HDR_linear / SDR_linear) per pixel, so decode = linearize(SDR) * gain.
 *
 * Adobe/Ultra HDR spec requires SDR base to be sRGB (display-ready).
 */
export interface EncodingResultFloat {
  /** SDR as sRGB in [0, 1], RGBA (spec: stored base image is sRGB) */
  sdrFloat: Float32Array;
  /** Gain map as [0, 1] (post-gamma encoded, same as gainMap/255), RGBA */
  gainMapFloat: Float32Array;
  width: number;
  height: number;
  metadata: GainMapMetadata;
}

export interface CompressedImage {
  data: Uint8Array;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}
