import { getToneMapping } from './mappers.js';
import type { ApplyToneMappingOptions } from './types.js';
import { validateToneMappingColorSpaceFromMetadata } from './validateColorSpace.js';

/**
 * Apply full HDR-to-LDR tone mapping pipeline.
 *
 * Input: Float32Array RGBA. Output: Uint8Array RGB.
 * Pipeline: exposure → tone mapping → gamma (default per mapper) → 0-255
 *
 * - ACES: outputs sRGB 0-1, default gamma: 1 (no-op)
 * - Reinhard: outputs linear 0-1, default gamma: 2.2 for display
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

  const toneMappingType = options.toneMapping ?? 'reinhard';
  const exposure = options.exposure ?? 1.0;
  const gamma = options.gamma ?? (toneMappingType === 'aces' ? 1 : 2.2);

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

    r = Number.isFinite(r) ? r ** (1.0 / gamma) : 0;
    g = Number.isFinite(g) ? g ** (1.0 / gamma) : 0;
    b = Number.isFinite(b) ? b ** (1.0 / gamma) : 0;

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
