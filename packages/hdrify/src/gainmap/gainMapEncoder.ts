import type { FloatImageData } from '../floatImage.js';
import { getToneMapping } from '../tonemapping/mappers.js';
import { validateToneMappingColorSpace } from '../tonemapping/validateColorSpace.js';
import type { EncodingResult, GainMapEncodingOptions, GainMapMetadata } from './types.js';

const defaultOffset = [1 / 64, 1 / 64, 1 / 64] as [number, number, number];
const defaultGamma = [1, 1, 1] as [number, number, number];

/**
 * Find max RGB value in HDR image for maxContentBoost.
 */
function findMaxContentBoost(data: Float32Array): number {
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const m = Math.max(r, g, b);
    if (m > max) max = m;
  }
  return max;
}

/**
 * Encode HDR image to SDR + gain map (pure TypeScript, no WebGL).
 */
export function encodeGainMap(image: FloatImageData, options: GainMapEncodingOptions = {}): EncodingResult {
  validateToneMappingColorSpace(image);

  const { width, height, data } = image;
  const totalPixels = width * height;

  const offsetSdr = options.offsetSdr ?? defaultOffset;
  const offsetHdr = options.offsetHdr ?? defaultOffset;
  const gamma = options.gamma ?? defaultGamma;
  const exposure = options.exposure ?? 1;
  const toneMapping = getToneMapping(options.toneMapping ?? 'aces');

  let maxContentBoost = options.maxContentBoost;
  if (maxContentBoost === undefined || maxContentBoost <= 0) {
    maxContentBoost = Math.max(findMaxContentBoost(data), 1.0001);
  }
  maxContentBoost = Math.max(maxContentBoost, 1.0001);
  const minContentBoost = options.minContentBoost ?? 1;
  const minLog2 = Math.log2(minContentBoost);
  const maxLog2 = Math.log2(maxContentBoost);

  const sdr = new Uint8ClampedArray(totalPixels * 4);
  const gainMap = new Uint8ClampedArray(totalPixels * 4);

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = (data[idx] ?? 0) * exposure;
    const g = (data[idx + 1] ?? 0) * exposure;
    const b = (data[idx + 2] ?? 0) * exposure;

    const [sr, sg, sb] = toneMapping(r, g, b);
    sdr[idx] = Math.round(sr * 255);
    sdr[idx + 1] = Math.round(sg * 255);
    sdr[idx + 2] = Math.round(sb * 255);
    sdr[idx + 3] = 255;

    const sdrR = sr + offsetSdr[0];
    const sdrG = sg + offsetSdr[1];
    const sdrB = sb + offsetSdr[2];
    const hdrR = r + offsetHdr[0];
    const hdrG = g + offsetHdr[1];
    const hdrB = b + offsetHdr[2];

    const pixelGainR = hdrR / sdrR;
    const pixelGainG = hdrG / sdrG;
    const pixelGainB = hdrB / sdrB;

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
