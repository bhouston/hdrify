import { convertFloat32ToLinearColorSpace } from '../color/convert.js';
import { linearTosRGB, sRGBToLinear } from '../color/srgb.js';
import { ensureNonNegativeFinite, type FloatImageData } from '../floatImage.js';
import { getToneMapping } from '../tonemapping/mappers.js';
import type { ToneMappingBatchFn, ToneMappingType } from '../tonemapping/types.js';
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
 * Uses batch tone mapping with shared linearRgbBuffer.
 */
function findMaxContentBoostFromGains(
  data: Float32Array,
  totalPixels: number,
  toneMapping: ToneMappingBatchFn,
  linearRgbBuffer: Float32Array,
  offsetSdr: [number, number, number],
  offsetHdr: [number, number, number],
  exposure: number,
): number {
  // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by totalPixels loop
  for (let i = 0; i < totalPixels; i++) {
    const srcIdx = i * 4;
    const dstIdx = i * 3;
    linearRgbBuffer[dstIdx] = data[srcIdx]! * exposure;
    linearRgbBuffer[dstIdx + 1] = data[srcIdx + 1]! * exposure;
    linearRgbBuffer[dstIdx + 2] = data[srcIdx + 2]! * exposure;
  }
  toneMapping(linearRgbBuffer, linearRgbBuffer, totalPixels);

  let maxGain = 1;
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 3;
    const sr = linearRgbBuffer[idx]!;
    const sg = linearRgbBuffer[idx + 1]!;
    const sb = linearRgbBuffer[idx + 2]!;
    const r = data[i * 4]! * exposure;
    const g = data[i * 4 + 1]! * exposure;
    const b = data[i * 4 + 2]! * exposure;
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
  // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by totalPixels loop
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

  const reuse = options.reuseMetadata;
  const offsetSdr = reuse?.offsetSdr ?? options.offsetSdr ?? defaultOffset;
  const offsetHdr = reuse?.offsetHdr ?? options.offsetHdr ?? defaultOffset;
  const gamma = reuse?.gamma ?? options.gamma ?? defaultGamma;
  const exposure = options.exposure ?? 1;
  const toneMappingType: ToneMappingType = options.toneMapping ?? 'aces';
  const toneMapping = getToneMapping(toneMappingType);

  const linearRgbBuffer = new Float32Array(totalPixels * 3);
  let maxContentBoost = options.maxContentBoost;
  let minContentBoost = options.minContentBoost;
  if (reuse) {
    minContentBoost = 2 ** reuse.gainMapMin[0];
    maxContentBoost = 2 ** reuse.gainMapMax[0];
  }
  if (maxContentBoost === undefined || maxContentBoost <= 0) {
    const fromGains = findMaxContentBoostFromGains(
      data,
      totalPixels,
      toneMapping,
      linearRgbBuffer,
      offsetSdr,
      offsetHdr,
      exposure,
    );
    maxContentBoost = Math.max(fromGains, findMaxHdrValue(data), 1.0001);
  }
  maxContentBoost = Math.max(maxContentBoost, 1.0001);
  minContentBoost ??= 1;
  const minLog2 = Math.log2(minContentBoost);
  let maxLog2 = Math.log2(maxContentBoost);
  const logRange = maxLog2 - minLog2;
  if (logRange <= 0) {
    maxLog2 = minLog2 + 1e-6;
  }
  const invLogRange = 1 / (maxLog2 - minLog2);

  const sdr = new Uint8ClampedArray(totalPixels * 4);
  const gainMap = new Uint8ClampedArray(totalPixels * 4);

  // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by totalPixels loop
  for (let i = 0; i < totalPixels; i++) {
    const srcIdx = i * 4;
    const dstIdx = i * 3;
    linearRgbBuffer[dstIdx] = data[srcIdx]! * exposure;
    linearRgbBuffer[dstIdx + 1] = data[srcIdx + 1]! * exposure;
    linearRgbBuffer[dstIdx + 2] = data[srcIdx + 2]! * exposure;
  }
  toneMapping(linearRgbBuffer, linearRgbBuffer, totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const si = i * 3;
    const sr = linearRgbBuffer[si]!;
    const sg = linearRgbBuffer[si + 1]!;
    const sb = linearRgbBuffer[si + 2]!;
    const r = data[idx]! * exposure;
    const g = data[idx + 1]! * exposure;
    const b = data[idx + 2]! * exposure;

    // Adobe/Ultra HDR spec: SDR base must be sRGB for display compatibility (standard JPEG).
    sdr[idx] = Math.round(linearTosRGB(sr) * 255);
    sdr[idx + 1] = Math.round(linearTosRGB(sg) * 255);
    sdr[idx + 2] = Math.round(linearTosRGB(sb) * 255);
    sdr[idx + 3] = 255;

    // Use the quantized SDR values (what the decoder will see) when computing the gain map,
    // so the stored ratio best recovers HDR from the actual 8-bit SDR.
    const sdrLinQuantizedR = sRGBToLinear(sdr[idx]! / 255) + offsetSdr[0];
    const sdrLinQuantizedG = sRGBToLinear(sdr[idx + 1]! / 255) + offsetSdr[1];
    const sdrLinQuantizedB = sRGBToLinear(sdr[idx + 2]! / 255) + offsetSdr[2];
    const hdrR = r + offsetHdr[0];
    const hdrG = g + offsetHdr[1];
    const hdrB = b + offsetHdr[2];

    const pixelGainR = sdrLinQuantizedR > 0 ? hdrR / sdrLinQuantizedR : 1;
    const pixelGainG = sdrLinQuantizedG > 0 ? hdrG / sdrLinQuantizedG : 1;
    const pixelGainB = sdrLinQuantizedB > 0 ? hdrB / sdrLinQuantizedB : 1;

    const logRecoveryR = (Math.log2(pixelGainR) - minLog2) * invLogRange;
    const logRecoveryG = (Math.log2(pixelGainG) - minLog2) * invLogRange;
    const logRecoveryB = (Math.log2(pixelGainB) - minLog2) * invLogRange;

    const clampedR = Math.max(0, Math.min(1, logRecoveryR));
    const clampedG = Math.max(0, Math.min(1, logRecoveryG));
    const clampedB = Math.max(0, Math.min(1, logRecoveryB));

    gainMap[idx] = Math.round(255 * clampedR ** gamma[0]);
    gainMap[idx + 1] = Math.round(255 * clampedG ** gamma[1]);
    gainMap[idx + 2] = Math.round(255 * clampedB ** gamma[2]);
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

  const linearRgbBuffer = new Float32Array(totalPixels * 3);
  let maxContentBoostFloat = options.maxContentBoost;
  if (maxContentBoostFloat === undefined || maxContentBoostFloat <= 0) {
    const fromGains = findMaxContentBoostFromGains(
      data,
      totalPixels,
      toneMappingFloat,
      linearRgbBuffer,
      offsetSdr,
      offsetHdr,
      exposure,
    );
    maxContentBoostFloat = Math.max(fromGains, findMaxHdrValue(data), 1.0001);
  }
  maxContentBoostFloat = Math.max(maxContentBoostFloat, 1.0001);
  const minContentBoost = options.minContentBoost ?? 1;
  const minLog2Float = Math.log2(minContentBoost);
  let maxLog2Float = Math.log2(maxContentBoostFloat);
  const logRangeFloat = maxLog2Float - minLog2Float;
  if (logRangeFloat <= 0) {
    maxLog2Float = minLog2Float + 1e-6;
  }
  const invLogRangeFloat = 1 / (maxLog2Float - minLog2Float);

  const sdrFloat = new Float32Array(totalPixels * 4);
  const gainMapFloat = new Float32Array(totalPixels * 4);

  // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by totalPixels loop
  for (let i = 0; i < totalPixels; i++) {
    const srcIdx = i * 4;
    const dstIdx = i * 3;
    linearRgbBuffer[dstIdx] = data[srcIdx]! * exposure;
    linearRgbBuffer[dstIdx + 1] = data[srcIdx + 1]! * exposure;
    linearRgbBuffer[dstIdx + 2] = data[srcIdx + 2]! * exposure;
  }
  toneMappingFloat(linearRgbBuffer, linearRgbBuffer, totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const si = i * 3;
    const sr = linearRgbBuffer[si]!;
    const sg = linearRgbBuffer[si + 1]!;
    const sb = linearRgbBuffer[si + 2]!;
    const r = data[idx]! * exposure;
    const g = data[idx + 1]! * exposure;
    const b = data[idx + 2]! * exposure;

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

    const logRecoveryR = (Math.log2(pixelGainR) - minLog2Float) * invLogRangeFloat;
    const logRecoveryG = (Math.log2(pixelGainG) - minLog2Float) * invLogRangeFloat;
    const logRecoveryB = (Math.log2(pixelGainB) - minLog2Float) * invLogRangeFloat;

    const clampedR = Math.max(0, Math.min(1, logRecoveryR));
    const clampedG = Math.max(0, Math.min(1, logRecoveryG));
    const clampedB = Math.max(0, Math.min(1, logRecoveryB));

    gainMapFloat[idx] = clampedR ** gamma[0];
    gainMapFloat[idx + 1] = clampedG ** gamma[1];
    gainMapFloat[idx + 2] = clampedB ** gamma[2];
    gainMapFloat[idx + 3] = 1;
  }
  // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by totalPixels * 4

  const gainMapMinLogFloat = [minLog2Float, minLog2Float, minLog2Float] as [number, number, number];
  const gainMapMaxLogFloat = [maxLog2Float, maxLog2Float, maxLog2Float] as [number, number, number];
  const hdrCapacityMinFloat = Math.min(
    Math.max(0, gainMapMinLogFloat[0]),
    Math.max(0, gainMapMinLogFloat[1]),
    Math.max(0, gainMapMinLogFloat[2]),
  );
  const hdrCapacityMaxFloat = Math.max(
    Math.max(0, gainMapMaxLogFloat[0]),
    Math.max(0, gainMapMaxLogFloat[1]),
    Math.max(0, gainMapMaxLogFloat[2]),
  );

  const metadata: GainMapMetadata = {
    gamma,
    offsetSdr,
    offsetHdr,
    gainMapMin: gainMapMinLogFloat,
    gainMapMax: gainMapMaxLogFloat,
    hdrCapacityMin: hdrCapacityMinFloat,
    hdrCapacityMax: hdrCapacityMaxFloat,
  };

  return {
    sdrFloat,
    gainMapFloat,
    width,
    height,
    metadata,
  };
}
