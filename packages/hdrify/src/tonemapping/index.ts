import { getToneMapping } from './mappers.js';
import type { ApplyToneMappingOptions } from './types.js';

export type { ApplyToneMappingOptions, ToneMappingFn, ToneMappingType } from './types.js';
export { getToneMapping } from './mappers.js';

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
  const toneMappingType = options.toneMapping ?? 'reinhard';
  const exposure = options.exposure ?? 1.0;
  const gamma =
    options.gamma ?? (toneMappingType === 'aces' ? 1 : 2.2);

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

    r = r ** (1.0 / gamma);
    g = g ** (1.0 / gamma);
    b = b ** (1.0 / gamma);

    const outputIndex = pixelIndex * 3;
    ldrData[outputIndex] = Math.max(0, Math.min(255, Math.round(r * 255)));
    ldrData[outputIndex + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
    ldrData[outputIndex + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
  }

  return ldrData;
}
