import { linearTosRGB } from '../color/srgb.js';
import { ensureNonNegativeFinite } from '../floatImage.js';
import { getToneMapping } from './mappers.js';
import type { ApplyToneMappingOptions, ToneMappingType } from './types.js';
import { validateToneMappingColorSpaceFromMetadata } from './validateColorSpace.js';

/**
 * Apply full HDR-to-LDR tone mapping pipeline.
 *
 * Input: Float32Array RGBA. Output: Uint8Array RGB in sRGB (IEC 61966-2-1).
 * Pipeline: exposure → tone mapping (linear 0-1) → linearToSrgb → 0-255
 * Mutates hdrData in-place (sanitizes to non-negative finite) before processing.
 */
export function applyToneMapping(
  hdrData: Float32Array,
  width: number,
  height: number,
  options: ApplyToneMappingOptions = {},
): Uint8Array {
  if (options.metadata) {
    validateToneMappingColorSpaceFromMetadata(options.metadata);
  }

  ensureNonNegativeFinite(hdrData);

  const toneMappingType: ToneMappingType = options.toneMapping ?? 'reinhard';
  const exposure = options.exposure ?? 1.0;
  const mapper = getToneMapping(toneMappingType);
  const totalPixels = width * height;
  const ldrData = new Uint8Array(totalPixels * 3);

  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex++) {
    const dataIndex = pixelIndex * 4;
    if (dataIndex + 2 >= hdrData.length) break;

    const rValue = hdrData[dataIndex];
    const gValue = hdrData[dataIndex + 1];
    const bValue = hdrData[dataIndex + 2];

    if (rValue === undefined || gValue === undefined || bValue === undefined) continue;

    let r = rValue * exposure;
    let g = gValue * exposure;
    let b = bValue * exposure;

    [r, g, b] = mapper(r, g, b);

    // All mappers output linear; apply sRGB transfer for display
    r = Number.isFinite(r) ? linearTosRGB(r) : 0;
    g = Number.isFinite(g) ? linearTosRGB(g) : 0;
    b = Number.isFinite(b) ? linearTosRGB(b) : 0;

    const outputIndex = pixelIndex * 3;
    const rOut = Number.isFinite(r) ? Math.round(r * 255) : 0;
    const gOut = Number.isFinite(g) ? Math.round(g * 255) : 0;
    const bOut = Number.isFinite(b) ? Math.round(b * 255) : 0;
    ldrData[outputIndex] = Math.max(0, Math.min(255, rOut));
    ldrData[outputIndex + 1] = Math.max(0, Math.min(255, gOut));
    ldrData[outputIndex + 2] = Math.max(0, Math.min(255, bOut));
  }

  return ldrData;
}
