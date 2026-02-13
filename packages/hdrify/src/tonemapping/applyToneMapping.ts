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
  const ldrData = new Uint8Array(totalPixels * 3);

  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex++) {
    const dataIndex = pixelIndex * 4;
    if (dataIndex + 2 >= dataToUse.length) break;

    // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by dataToUse.length loop
    const rValue = dataToUse[dataIndex]!;
    const gValue = dataToUse[dataIndex + 1]!;
    const bValue = dataToUse[dataIndex + 2]!;
    // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by dataToUse.length loop

    let r = rValue * exposure;
    let g = gValue * exposure;
    let b = bValue * exposure;

    [r, g, b] = mapper(r, g, b);

    // All mappers output linear; apply sRGB transfer for display
    r = linearTosRGB(r);
    g = linearTosRGB(g);
    b = linearTosRGB(b);

    const outputIndex = pixelIndex * 3;
    ldrData[outputIndex] = Math.max(0, Math.min(255, r * 255 + 0.5));
    ldrData[outputIndex + 1] = Math.max(0, Math.min(255, g * 255 + 0.5));
    ldrData[outputIndex + 2] = Math.max(0, Math.min(255, b * 255 + 0.5));
  }

  return ldrData;
}
