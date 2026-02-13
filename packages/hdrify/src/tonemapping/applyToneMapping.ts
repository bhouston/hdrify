import { convertFloat32ToLinearColorSpace } from '../color/convert.js';
import { linearTosRGB } from '../color/srgb.js';
import { ensureNonNegativeFinite } from '../floatImage.js';
import { getToneMapping } from './mappers.js';
import type { ApplyToneMappingOptions, ToneMappingType } from './types.js';
import { validateToneMappingColorSpaceFromMetadata } from './validateColorSpace.js';

/**
 * Apply full HDR-to-LDR tone mapping pipeline.
 *
 * Input: Float32Array RGBA. Output: Uint8Array RGB in sRGB (IEC 61966-2-1).
 * Pipeline: (optional color space conversion) → exposure → tone mapping (linear 0-1) → linearToSrgb → 0-255
 * Mutates hdrData in-place (sanitizes to non-negative finite) before processing.
 * Uses batch mappers with a single reusable buffer to minimize allocations.
 */
export function applyToneMapping(
  hdrData: Float32Array,
  width: number,
  height: number,
  options: ApplyToneMappingOptions = {},
): Uint8Array {
  const sourceColorSpace = options.sourceColorSpace ?? 'linear-rec709';
  let dataToUse = hdrData;

  ensureNonNegativeFinite(dataToUse);

  if (sourceColorSpace !== 'linear-rec709') {
    dataToUse = convertFloat32ToLinearColorSpace(dataToUse, width, height, sourceColorSpace, 'linear-rec709');
  } else if (options.metadata) {
    validateToneMappingColorSpaceFromMetadata(options.metadata);
  }

  const toneMappingType: ToneMappingType = options.toneMapping ?? 'reinhard';
  const exposure = options.exposure ?? 1.0;
  const mapper = getToneMapping(toneMappingType);
  const totalPixels = width * height;

  // Single buffer for exposure-adjusted RGB, reused for tone mapping output (in-place)
  const linearRgbBuffer = new Float32Array(totalPixels * 3);
  const ldrData = new Uint8Array(totalPixels * 3);

  // Fill linearRgbBuffer with exposure-adjusted RGB from RGBA input
  // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by totalPixels loop
  for (let i = 0; i < totalPixels; i++) {
    const srcIdx = i * 4;
    const dstIdx = i * 3;
    if (srcIdx + 2 >= dataToUse.length) break;
    linearRgbBuffer[dstIdx] = dataToUse[srcIdx]! * exposure;
    linearRgbBuffer[dstIdx + 1] = dataToUse[srcIdx + 1]! * exposure;
    linearRgbBuffer[dstIdx + 2] = dataToUse[srcIdx + 2]! * exposure;
  }

  // Batch tone mapping (in-place)
  mapper(linearRgbBuffer, linearRgbBuffer, totalPixels);

  // linearTosRGB + quantize to Uint8
  for (let i = 0; i < totalPixels; i++) {
    const srcIdx = i * 3;
    const dstIdx = i * 3;
    const r = linearTosRGB(linearRgbBuffer[srcIdx]!);
    const g = linearTosRGB(linearRgbBuffer[srcIdx + 1]!);
    const b = linearTosRGB(linearRgbBuffer[srcIdx + 2]!);
    ldrData[dstIdx] = Math.max(0, Math.min(255, r * 255 + 0.5));
    ldrData[dstIdx + 1] = Math.max(0, Math.min(255, g * 255 + 0.5));
    ldrData[dstIdx + 2] = Math.max(0, Math.min(255, b * 255 + 0.5));
  }
  // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by totalPixels loop

  return ldrData;
}
