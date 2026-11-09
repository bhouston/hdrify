/**
 * CPU decode: apply gain map to SDR to produce HDR Float32 RGBA.
 * Matches UltraHDR/gainmap-js formula: logRecovery, logBoost, weightFactor, offsets.
 *
 * The base is linearized (sRGB by default) and the gain is applied in the base's own primaries, as
 * libultrahdr does for XMP (hdrgm) metadata; any gamut conversion happens afterwards.
 */

import { sRGBToLinear } from '../../color/srgb.js';
import type { HdrifyImage } from '../../hdrifyImage.js';
import type { GainMapMetadata } from '../types.js';

const HALF_FLOAT_MAX = 65504;

export interface DecodeGainMapOptions {
  /** Maximum display boost for weight factor; default full HDR (weightFactor = 1) */
  maxDisplayBoost?: number;
}

function isFloat32Array(a: Uint8Array | Uint8ClampedArray | Float32Array): a is Float32Array {
  return a instanceof Float32Array;
}

/** Per-channel base decoding: encoded [0, 1] → linear light. */
export type BaseDecode = readonly [(v: number) => number, (v: number) => number, (v: number) => number];
const SRGB_DECODE: BaseDecode = [sRGBToLinear, sRGBToLinear, sRGBToLinear];

/**
 * Decode SDR + gain map pixels with metadata into linear HDR HdrifyImage.
 * SDR and gainMap can be 0-255 RGBA (Uint8) or 0-1 float (Float32Array). Mixed modes supported.
 * The result is in the base's linear primaries, labelled `linear-rec709` (correct for the default sRGB decode);
 * callers passing another `decode` relabel or convert it.
 */
export function decodeGainMapCpu(
  sdr: Uint8ClampedArray | Uint8Array | Float32Array,
  gainMap: Uint8ClampedArray | Uint8Array | Float32Array,
  width: number,
  height: number,
  metadata: GainMapMetadata,
  options: DecodeGainMapOptions = {},
  decode: BaseDecode = SRGB_DECODE,
): HdrifyImage {
  const { gamma, offsetSdr, offsetHdr, gainMapMin, gainMapMax, hdrCapacityMin, hdrCapacityMax } = metadata;

  const maxDisplayBoost = options.maxDisplayBoost ?? 2 ** hdrCapacityMax;
  const capacityRange = hdrCapacityMax - hdrCapacityMin;
  const unclampedWeight = capacityRange <= 0 ? 1 : (Math.log2(maxDisplayBoost) - hdrCapacityMin) / capacityRange;
  const weightFactor = Math.max(0, Math.min(1, unclampedWeight));

  const invGamma = [1 / gamma[0], 1 / gamma[1], 1 / gamma[2]] as [number, number, number];
  const useGammaOne = gamma[0] === 1 && gamma[1] === 1 && gamma[2] === 1;

  const sdrIsFloat = isFloat32Array(sdr);
  const [d0, d1, d2] = decode;
  const [l0, l1, l2] = decode.map((d) => Float64Array.from({ length: 256 }, (_, i) => d(i / 255)));
  const gainMapIsFloat = isFloat32Array(gainMap);

  const pixelCount = width * height;
  const out = new Float32Array(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const i4 = i * 4;
    // Linearize the base before applying gain.
    const sdrR = sdrIsFloat ? d0(sdr[i4]!) : l0![sdr[i4]!]!;
    const sdrG = sdrIsFloat ? d1(sdr[i4 + 1]!) : l1![sdr[i4 + 1]!]!;
    const sdrB = sdrIsFloat ? d2(sdr[i4 + 2]!) : l2![sdr[i4 + 2]!]!;

    const gainR = gainMapIsFloat ? gainMap[i4]! : gainMap[i4]! / 255;
    const gainG = gainMapIsFloat ? gainMap[i4 + 1]! : gainMap[i4 + 1]! / 255;
    const gainB = gainMapIsFloat ? gainMap[i4 + 2]! : gainMap[i4 + 2]! / 255;

    const logRecoveryR = useGammaOne ? gainR : gainR ** invGamma[0];
    const logRecoveryG = useGammaOne ? gainG : gainG ** invGamma[1];
    const logRecoveryB = useGammaOne ? gainB : gainB ** invGamma[2];

    const logBoostR = gainMapMin[0] * (1 - logRecoveryR) + gainMapMax[0] * logRecoveryR;
    const logBoostG = gainMapMin[1] * (1 - logRecoveryG) + gainMapMax[1] * logRecoveryG;
    const logBoostB = gainMapMin[2] * (1 - logRecoveryB) + gainMapMax[2] * logRecoveryB;

    const w = weightFactor;
    const hdrR = (sdrR + offsetSdr[0]) * (w * logBoostR === 0 ? 1 : 2 ** (logBoostR * w)) - offsetHdr[0];
    const hdrG = (sdrG + offsetSdr[1]) * (w * logBoostG === 0 ? 1 : 2 ** (logBoostG * w)) - offsetHdr[1];
    const hdrB = (sdrB + offsetSdr[2]) * (w * logBoostB === 0 ? 1 : 2 ** (logBoostB * w)) - offsetHdr[2];

    out[i4] = Math.max(0, Math.min(HALF_FLOAT_MAX, hdrR));
    out[i4 + 1] = Math.max(0, Math.min(HALF_FLOAT_MAX, hdrG));
    out[i4 + 2] = Math.max(0, Math.min(HALF_FLOAT_MAX, hdrB));
    out[i4 + 3] = 1;
  }

  return {
    width,
    height,
    data: out,
    linearColorSpace: 'linear-rec709',
  };
}

/**
 * Decode from float SDR and float gain map (no quantization). For testing and incremental pipeline.
 * Same formula as decodeGainMapCpu. sdrFloat is sRGB [0,1] per spec (matches stored base image).
 */
export function decodeGainMapFromFloat(
  sdrFloat: Float32Array,
  gainMapFloat: Float32Array,
  width: number,
  height: number,
  metadata: GainMapMetadata,
  options: DecodeGainMapOptions = {},
): HdrifyImage {
  const { gamma, offsetSdr, offsetHdr, gainMapMin, gainMapMax, hdrCapacityMin, hdrCapacityMax } = metadata;

  const maxDisplayBoost = options.maxDisplayBoost ?? 2 ** hdrCapacityMax;
  const capacityRange = hdrCapacityMax - hdrCapacityMin;
  const unclampedWeight = capacityRange <= 0 ? 1 : (Math.log2(maxDisplayBoost) - hdrCapacityMin) / capacityRange;
  const weightFactor = Math.max(0, Math.min(1, unclampedWeight));

  const invGamma = [1 / gamma[0], 1 / gamma[1], 1 / gamma[2]] as [number, number, number];
  const useGammaOne = gamma[0] === 1 && gamma[1] === 1 && gamma[2] === 1;

  const pixelCount = width * height;
  const out = new Float32Array(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const i4 = i * 4;
    // The encoder reference path uses an sRGB base; linearize before applying gain.
    const sdrR = sRGBToLinear(sdrFloat[i4]!);
    const sdrG = sRGBToLinear(sdrFloat[i4 + 1]!);
    const sdrB = sRGBToLinear(sdrFloat[i4 + 2]!);

    const gainR = gainMapFloat[i4]!;
    const gainG = gainMapFloat[i4 + 1]!;
    const gainB = gainMapFloat[i4 + 2]!;

    const logRecoveryR = useGammaOne ? gainR : gainR ** invGamma[0];
    const logRecoveryG = useGammaOne ? gainG : gainG ** invGamma[1];
    const logRecoveryB = useGammaOne ? gainB : gainB ** invGamma[2];

    const logBoostR = gainMapMin[0] * (1 - logRecoveryR) + gainMapMax[0] * logRecoveryR;
    const logBoostG = gainMapMin[1] * (1 - logRecoveryG) + gainMapMax[1] * logRecoveryG;
    const logBoostB = gainMapMin[2] * (1 - logRecoveryB) + gainMapMax[2] * logRecoveryB;

    const w = weightFactor;
    const hdrR = (sdrR + offsetSdr[0]) * (w * logBoostR === 0 ? 1 : 2 ** (logBoostR * w)) - offsetHdr[0];
    const hdrG = (sdrG + offsetSdr[1]) * (w * logBoostG === 0 ? 1 : 2 ** (logBoostG * w)) - offsetHdr[1];
    const hdrB = (sdrB + offsetSdr[2]) * (w * logBoostB === 0 ? 1 : 2 ** (logBoostB * w)) - offsetHdr[2];

    out[i4] = Math.max(0, Math.min(HALF_FLOAT_MAX, hdrR));
    out[i4 + 1] = Math.max(0, Math.min(HALF_FLOAT_MAX, hdrG));
    out[i4 + 2] = Math.max(0, Math.min(HALF_FLOAT_MAX, hdrB));
    out[i4 + 3] = 1;
  }

  return {
    width,
    height,
    data: out,
    linearColorSpace: 'linear-rec709',
  };
}
