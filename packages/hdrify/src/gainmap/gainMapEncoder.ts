import { convertFloat32ToLinearColorSpace } from '../color/convert.js';
import { linearTosRGB } from '../color/srgb.js';
import { ensureNonNegativeFinite, type FloatImageData } from '../floatImage.js';
import { getToneMapping } from '../tonemapping/mappers.js';
import type { ToneMappingType } from '../tonemapping/types.js';
import type { EncodingResult, EncodingResultFloat, GainMapEncodingOptions, GainMapMetadata } from './types.js';

const defaultOffset = [1 / 64, 1 / 64, 1 / 64] as [number, number, number];
const defaultGamma = [1, 1, 1] as [number, number, number];

/**
 * Find max RGB value in HDR image (for backward compat / fallback).
 */
function findMaxHdrValue(data: Float32Array): number {
  let max = 0;
  // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by data.length loop
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const m = Math.max(r, g, b);
    if (m > max) max = m;
  }
  // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by data.length loop
  return max;
}

/**
 * Compute max content boost from actual gains (HDR_linear / SDR_linear) so we don't clamp logRecovery.
 */
function findMaxContentBoostFromGains(
  image: FloatImageData,
  toneMapping: (r: number, g: number, b: number) => [number, number, number],
  offsetSdr: [number, number, number],
  offsetHdr: [number, number, number],
  exposure: number,
): number {
  const { data } = image;
  let maxGain = 1;
  // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by data.length loop
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]! * exposure;
    const g = data[i + 1]! * exposure;
    const b = data[i + 2]! * exposure;
    const [sr, sg, sb] = toneMapping(r, g, b);
    const sdrLinR = sr + offsetSdr[0];
    const sdrLinG = sg + offsetSdr[1];
    const sdrLinB = sb + offsetSdr[2];
    const hdrR = r + offsetHdr[0];
    const hdrG = g + offsetHdr[1];
    const hdrB = b + offsetHdr[2];
    const gainR = sdrLinR > 0 ? hdrR / sdrLinR : 1;
    const gainG = sdrLinG > 0 ? hdrG / sdrLinG : 1;
    const gainB = sdrLinB > 0 ? hdrB / sdrLinB : 1;
    const m = Math.max(gainR, gainG, gainB);
    if (m > maxGain) maxGain = m;
  }
  // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by data.length loop
  return maxGain;
}

/**
 * Encode HDR image to SDR + gain map (pure TypeScript, no WebGL).
 */
export function encodeGainMap(image: FloatImageData, options: GainMapEncodingOptions = {}): EncodingResult {
  ensureNonNegativeFinite(image.data);
  const data = convertFloat32ToLinearColorSpace(
    image.data,
    image.width,
    image.height,
    image.linearColorSpace,
    'linear-rec709',
  );

  const { width, height } = image;
  const totalPixels = width * height;

  const offsetSdr = options.offsetSdr ?? defaultOffset;
  const offsetHdr = options.offsetHdr ?? defaultOffset;
  const gamma = options.gamma ?? defaultGamma;
  const exposure = options.exposure ?? 1;
  const toneMappingType: ToneMappingType = options.toneMapping ?? 'aces';
  const toneMapping = getToneMapping(toneMappingType);

  const imageForGains = { ...image, data };
  let maxContentBoost = options.maxContentBoost;
  if (maxContentBoost === undefined || maxContentBoost <= 0) {
    const fromGains = findMaxContentBoostFromGains(imageForGains, toneMapping, offsetSdr, offsetHdr, exposure);
    maxContentBoost = Math.max(fromGains, findMaxHdrValue(data), 1.0001);
  }
  maxContentBoost = Math.max(maxContentBoost, 1.0001);
  const minContentBoost = options.minContentBoost ?? 1;
  const minLog2 = Math.log2(minContentBoost);
  const maxLog2 = Math.log2(maxContentBoost);

  const sdr = new Uint8ClampedArray(totalPixels * 4);
  const gainMap = new Uint8ClampedArray(totalPixels * 4);

  // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by totalPixels * 4
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx]! * exposure;
    const g = data[idx + 1]! * exposure;
    const b = data[idx + 2]! * exposure;

    const [sr, sg, sb] = toneMapping(r, g, b);
    // Adobe/Ultra HDR spec: SDR base must be sRGB for display compatibility (standard JPEG).
    // Gain computation uses linear; decode linearizes stored SDR before applying gain.
    sdr[idx] = Math.round(linearTosRGB(sr) * 255);
    sdr[idx + 1] = Math.round(linearTosRGB(sg) * 255);
    sdr[idx + 2] = Math.round(linearTosRGB(sb) * 255);
    sdr[idx + 3] = 255;

    const sdrLinR = sr + offsetSdr[0];
    const sdrLinG = sg + offsetSdr[1];
    const sdrLinB = sb + offsetSdr[2];
    const hdrR = r + offsetHdr[0];
    const hdrG = g + offsetHdr[1];
    const hdrB = b + offsetHdr[2];

    const pixelGainR = hdrR / sdrLinR;
    const pixelGainG = hdrG / sdrLinG;
    const pixelGainB = hdrB / sdrLinB;

    const logRecoveryR = (Math.log2(pixelGainR) - minLog2) / (maxLog2 - minLog2);
    const logRecoveryG = (Math.log2(pixelGainG) - minLog2) / (maxLog2 - minLog2);
    const logRecoveryB = (Math.log2(pixelGainB) - minLog2) / (maxLog2 - minLog2);

    const clampedR = Math.max(0, Math.min(1, logRecoveryR));
    const clampedG = Math.max(0, Math.min(1, logRecoveryG));
    const clampedB = Math.max(0, Math.min(1, logRecoveryB));

    const outR = Math.round(255 * clampedR ** gamma[0]);
    const outG = Math.round(255 * clampedG ** gamma[1]);
    const outB = Math.round(255 * clampedB ** gamma[2]);

    gainMap[idx] = outR;
    gainMap[idx + 1] = outG;
    gainMap[idx + 2] = outB;
    gainMap[idx + 3] = 255;
  }
  // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by totalPixels * 4

  const gainMapMinLog = [minLog2, minLog2, minLog2] as [number, number, number];
  const gainMapMaxLog = [maxLog2, maxLog2, maxLog2] as [number, number, number];
  const hdrCapacityMin = Math.min(
    Math.max(0, gainMapMinLog[0]),
    Math.max(0, gainMapMinLog[1]),
    Math.max(0, gainMapMinLog[2]),
  );
  const hdrCapacityMax = Math.max(
    Math.max(0, gainMapMaxLog[0]),
    Math.max(0, gainMapMaxLog[1]),
    Math.max(0, gainMapMaxLog[2]),
  );

  const metadata: GainMapMetadata = {
    gamma,
    offsetSdr,
    offsetHdr,
    gainMapMin: gainMapMinLog,
    gainMapMax: gainMapMaxLog,
    hdrCapacityMin,
    hdrCapacityMax,
  };

  return {
    sdr,
    gainMap,
    width,
    height,
    metadata,
  };
}

/**
 * Encode to float buffers only (no quantization). For testing and incremental pipeline.
 * Decode is tone-map-agnostic: the gain map stores the ratio HDR_linear/SDR_linear.
 */
export function encodeGainMapToFloat(image: FloatImageData, options: GainMapEncodingOptions = {}): EncodingResultFloat {
  ensureNonNegativeFinite(image.data);
  const data = convertFloat32ToLinearColorSpace(
    image.data,
    image.width,
    image.height,
    image.linearColorSpace,
    'linear-rec709',
  );

  const { width, height } = image;
  const totalPixels = width * height;

  const offsetSdr = options.offsetSdr ?? defaultOffset;
  const offsetHdr = options.offsetHdr ?? defaultOffset;
  const gamma = options.gamma ?? defaultGamma;
  const exposure = options.exposure ?? 1;
  const toneMappingTypeFloat: ToneMappingType = options.toneMapping ?? 'aces';
  const toneMappingFloat = getToneMapping(toneMappingTypeFloat);

  const imageForGainsFloat = { ...image, data };
  let maxContentBoostFloat = options.maxContentBoost;
  if (maxContentBoostFloat === undefined || maxContentBoostFloat <= 0) {
    const fromGains = findMaxContentBoostFromGains(
      imageForGainsFloat,
      toneMappingFloat,
      offsetSdr,
      offsetHdr,
      exposure,
    );
    maxContentBoostFloat = Math.max(fromGains, findMaxHdrValue(data), 1.0001);
  }
  maxContentBoostFloat = Math.max(maxContentBoostFloat, 1.0001);
  const minContentBoost = options.minContentBoost ?? 1;
  const minLog2 = Math.log2(minContentBoost);
  const maxLog2 = Math.log2(maxContentBoostFloat);

  const sdrFloat = new Float32Array(totalPixels * 4);
  const gainMapFloat = new Float32Array(totalPixels * 4);

  // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by totalPixels * 4
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx]! * exposure;
    const g = data[idx + 1]! * exposure;
    const b = data[idx + 2]! * exposure;

    const [sr, sg, sb] = toneMappingFloat(r, g, b);
    // Per Adobe/Ultra HDR spec: SDR base is sRGB (matches file format). sdrFloat mirrors
    // the stored SDR so quantize(sdrFloat) produces spec-compliant sRGB bytes.
    sdrFloat[idx] = linearTosRGB(sr);
    sdrFloat[idx + 1] = linearTosRGB(sg);
    sdrFloat[idx + 2] = linearTosRGB(sb);
    sdrFloat[idx + 3] = 1;

    const sdrLinR = sr + offsetSdr[0];
    const sdrLinG = sg + offsetSdr[1];
    const sdrLinB = sb + offsetSdr[2];
    const hdrR = r + offsetHdr[0];
    const hdrG = g + offsetHdr[1];
    const hdrB = b + offsetHdr[2];

    const pixelGainR = hdrR / sdrLinR;
    const pixelGainG = hdrG / sdrLinG;
    const pixelGainB = hdrB / sdrLinB;

    const logRecoveryR = (Math.log2(pixelGainR) - minLog2) / (maxLog2 - minLog2);
    const logRecoveryG = (Math.log2(pixelGainG) - minLog2) / (maxLog2 - minLog2);
    const logRecoveryB = (Math.log2(pixelGainB) - minLog2) / (maxLog2 - minLog2);

    const clampedR = Math.max(0, Math.min(1, logRecoveryR));
    const clampedG = Math.max(0, Math.min(1, logRecoveryG));
    const clampedB = Math.max(0, Math.min(1, logRecoveryB));

    gainMapFloat[idx] = clampedR ** gamma[0];
    gainMapFloat[idx + 1] = clampedG ** gamma[1];
    gainMapFloat[idx + 2] = clampedB ** gamma[2];
    gainMapFloat[idx + 3] = 1;
  }
  // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by totalPixels * 4

  const gainMapMinLog = [minLog2, minLog2, minLog2] as [number, number, number];
  const gainMapMaxLog = [maxLog2, maxLog2, maxLog2] as [number, number, number];
  const hdrCapacityMin = Math.min(
    Math.max(0, gainMapMinLog[0]),
    Math.max(0, gainMapMinLog[1]),
    Math.max(0, gainMapMinLog[2]),
  );
  const hdrCapacityMax = Math.max(
    Math.max(0, gainMapMaxLog[0]),
    Math.max(0, gainMapMaxLog[1]),
    Math.max(0, gainMapMaxLog[2]),
  );

  const metadata: GainMapMetadata = {
    gamma,
    offsetSdr,
    offsetHdr,
    gainMapMin: gainMapMinLog,
    gainMapMax: gainMapMaxLog,
    hdrCapacityMin,
    hdrCapacityMax,
  };

  return {
    sdrFloat,
    gainMapFloat,
    width,
    height,
    metadata,
  };
}
