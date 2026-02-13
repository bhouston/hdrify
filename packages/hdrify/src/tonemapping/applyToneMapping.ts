import { linearTosRGB } from '../color/srgb.js';
import { getToneMapping, getToneMappingOutputSpace } from './mappers.js';
import type { ApplyToneMappingOptions } from './types.js';
import type { ToneMappingType } from './types.js';
import { validateToneMappingColorSpaceFromMetadata } from './validateColorSpace.js';

/**
 * Apply full HDR-to-LDR tone mapping pipeline.
 *
 * Input: Float32Array RGBA. Output: Uint8Array RGB in sRGB (IEC 61966-2-1).
 * Pipeline: exposure → tone mapping → (linearToSrgb only if mapper output is linear) → 0-255
 * ACES and AgX output display-referred; Reinhard and Neutral output linear.
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

  const toneMappingType: ToneMappingType = options.toneMapping ?? 'reinhard';
  const exposure = options.exposure ?? 1.0;
  const outputSpace = getToneMappingOutputSpace(toneMappingType);

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

    // Sanitize: replace NaN/Inf with 0 before tone mapping
    r = Number.isFinite(r) ? r : 0;
    g = Number.isFinite(g) ? g : 0;
    b = Number.isFinite(b) ? b : 0;

    [r, g, b] = mapper(r, g, b);

    // Only apply linearToSrgb when mapper output is linear (Reinhard, Neutral)
    if (outputSpace === 'linear') {
      r = Number.isFinite(r) ? linearTosRGB(r) : 0;
      g = Number.isFinite(g) ? linearTosRGB(g) : 0;
      b = Number.isFinite(b) ? linearTosRGB(b) : 0;
    }

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
