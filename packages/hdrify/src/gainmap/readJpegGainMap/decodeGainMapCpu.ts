/**
 * CPU decode: apply gain map to SDR to produce HDR Float32 RGBA.
 * Matches UltraHDR/gainmap-js formula: logRecovery, logBoost, weightFactor, offsets.
 * SDR base is sRGB in the file; we linearize (bytes→float then sRGB→linear) before applying gain.
 */

import { sRGBToLinear } from '../../color/srgb.js';
import type { FloatImageData } from '../../floatImage.js';
import type { GainMapMetadata } from '../types.js';

const HALF_FLOAT_MAX = 65504;

export interface DecodeGainMapOptions {
  /** Maximum display boost for weight factor; default full HDR (weightFactor = 1) */
  maxDisplayBoost?: number;
}

function isFloat32Array(a: Uint8Array | Uint8ClampedArray | Float32Array): a is Float32Array {
  return a instanceof Float32Array;
}

/**
 * Decode SDR + gain map pixels with metadata into linear HDR FloatImageData.
 * SDR and gainMap can be 0-255 RGBA (Uint8) or 0-1 float (Float32Array). Mixed modes supported.
 */
export function decodeGainMapCpu(
  sdr: Uint8ClampedArray | Uint8Array | Float32Array,
  gainMap: Uint8ClampedArray | Uint8Array | Float32Array,
  width: number,
  height: number,
  metadata: GainMapMetadata,
  options: DecodeGainMapOptions = {},
): FloatImageData {
  const { gamma, offsetSdr, offsetHdr, gainMapMin, gainMapMax, hdrCapacityMin, hdrCapacityMax } =
    metadata;

  const maxDisplayBoost = options.maxDisplayBoost ?? 2 ** hdrCapacityMax;
  const unclampedWeight =
    (Math.log2(maxDisplayBoost) - hdrCapacityMin) / (hdrCapacityMax - hdrCapacityMin);
  const weightFactor = Math.max(0, Math.min(1, unclampedWeight));

  const invGamma = [1 / gamma[0], 1 / gamma[1], 1 / gamma[2]] as [number, number, number];
  const useGammaOne = gamma[0] === 1 && gamma[1] === 1 && gamma[2] === 1;

  const sdrIsFloat = isFloat32Array(sdr);
  const gainMapIsFloat = isFloat32Array(gainMap);

  const pixelCount = width * height;
  const out = new Float32Array(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const i4 = i * 4;

    // Float SDR from our encoder is linear 0-1; 8-bit SDR from file is sRGB, linearize
    const sdrR = sdrIsFloat
      ? (sdr[i4] ?? 0)
      : sRGBToLinear((sdr[i4] ?? 0) / 255);
    const sdrG = sdrIsFloat
      ? (sdr[i4 + 1] ?? 0)
      : sRGBToLinear((sdr[i4 + 1] ?? 0) / 255);
    const sdrB = sdrIsFloat
      ? (sdr[i4 + 2] ?? 0)
      : sRGBToLinear((sdr[i4 + 2] ?? 0) / 255);

    const gainR = gainMapIsFloat ? (gainMap[i4] ?? 0) : (gainMap[i4] ?? 0) / 255;
    const gainG = gainMapIsFloat ? (gainMap[i4 + 1] ?? 0) : (gainMap[i4 + 1] ?? 0) / 255;
    const gainB = gainMapIsFloat ? (gainMap[i4 + 2] ?? 0) : (gainMap[i4 + 2] ?? 0) / 255;

    const logRecoveryR = useGammaOne ? gainR : gainR ** invGamma[0];
    const logRecoveryG = useGammaOne ? gainG : gainG ** invGamma[1];
    const logRecoveryB = useGammaOne ? gainB : gainB ** invGamma[2];

    const logBoostR = gainMapMin[0] * (1 - logRecoveryR) + gainMapMax[0] * logRecoveryR;
    const logBoostG = gainMapMin[1] * (1 - logRecoveryG) + gainMapMax[1] * logRecoveryG;
    const logBoostB = gainMapMin[2] * (1 - logRecoveryB) + gainMapMax[2] * logRecoveryB;

    const w = weightFactor;
    const hdrR =
      (sdrR + offsetSdr[0]) * (w * logBoostR === 0 ? 1 : 2 ** (logBoostR * w)) - offsetHdr[0];
    const hdrG =
      (sdrG + offsetSdr[1]) * (w * logBoostG === 0 ? 1 : 2 ** (logBoostG * w)) - offsetHdr[1];
    const hdrB =
      (sdrB + offsetSdr[2]) * (w * logBoostB === 0 ? 1 : 2 ** (logBoostB * w)) - offsetHdr[2];

    out[i4] = Math.max(0, Math.min(HALF_FLOAT_MAX, hdrR));
    out[i4 + 1] = Math.max(0, Math.min(HALF_FLOAT_MAX, hdrG));
    out[i4 + 2] = Math.max(0, Math.min(HALF_FLOAT_MAX, hdrB));
    out[i4 + 3] = 1;
  }

  return {
    width,
    height,
    data: out,
  };
}

/**
 * Decode from float SDR and float gain map (no quantization). For testing and incremental pipeline.
 * Same formula as decodeGainMapCpu; inputs are already in [0,1] (sdrFloat = sRGB 0-1, gainMapFloat = post-gamma 0-1).
 */
export function decodeGainMapFromFloat(
  sdrFloat: Float32Array,
  gainMapFloat: Float32Array,
  width: number,
  height: number,
  metadata: GainMapMetadata,
  options: DecodeGainMapOptions = {},
): FloatImageData {
  const { gamma, offsetSdr, offsetHdr, gainMapMin, gainMapMax, hdrCapacityMin, hdrCapacityMax } =
    metadata;

  const maxDisplayBoost = options.maxDisplayBoost ?? 2 ** hdrCapacityMax;
  const unclampedWeight =
    (Math.log2(maxDisplayBoost) - hdrCapacityMin) / (hdrCapacityMax - hdrCapacityMin);
  const weightFactor = Math.max(0, Math.min(1, unclampedWeight));

  const invGamma = [1 / gamma[0], 1 / gamma[1], 1 / gamma[2]] as [number, number, number];
  const useGammaOne = gamma[0] === 1 && gamma[1] === 1 && gamma[2] === 1;

  const pixelCount = width * height;
  const out = new Float32Array(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const i4 = i * 4;

    const sdrR = sRGBToLinear(sdrFloat[i4] ?? 0);
    const sdrG = sRGBToLinear(sdrFloat[i4 + 1] ?? 0);
    const sdrB = sRGBToLinear(sdrFloat[i4 + 2] ?? 0);

    const gainR = gainMapFloat[i4] ?? 0;
    const gainG = gainMapFloat[i4 + 1] ?? 0;
    const gainB = gainMapFloat[i4 + 2] ?? 0;

    const logRecoveryR = useGammaOne ? gainR : gainR ** invGamma[0];
    const logRecoveryG = useGammaOne ? gainG : gainG ** invGamma[1];
    const logRecoveryB = useGammaOne ? gainB : gainB ** invGamma[2];

    const logBoostR = gainMapMin[0] * (1 - logRecoveryR) + gainMapMax[0] * logRecoveryR;
    const logBoostG = gainMapMin[1] * (1 - logRecoveryG) + gainMapMax[1] * logRecoveryG;
    const logBoostB = gainMapMin[2] * (1 - logRecoveryB) + gainMapMax[2] * logRecoveryB;

    const w = weightFactor;
    const hdrR =
      (sdrR + offsetSdr[0]) * (w * logBoostR === 0 ? 1 : 2 ** (logBoostR * w)) - offsetHdr[0];
    const hdrG =
      (sdrG + offsetSdr[1]) * (w * logBoostG === 0 ? 1 : 2 ** (logBoostG * w)) - offsetHdr[1];
    const hdrB =
      (sdrB + offsetSdr[2]) * (w * logBoostB === 0 ? 1 : 2 ** (logBoostB * w)) - offsetHdr[2];

    out[i4] = Math.max(0, Math.min(HALF_FLOAT_MAX, hdrR));
    out[i4 + 1] = Math.max(0, Math.min(HALF_FLOAT_MAX, hdrG));
    out[i4 + 2] = Math.max(0, Math.min(HALF_FLOAT_MAX, hdrB));
    out[i4 + 3] = 1;
  }

  return {
    width,
    height,
    data: out,
  };
}
