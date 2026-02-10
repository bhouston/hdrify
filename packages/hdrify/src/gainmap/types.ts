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

export interface CompressedImage {
  data: Uint8Array;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}
