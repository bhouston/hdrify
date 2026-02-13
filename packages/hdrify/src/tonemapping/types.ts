export type ToneMappingType = 'aces' | 'reinhard' | 'neutral' | 'agx';

/**
 * Batch tone mapping: reads RGB from input (stride 3), writes linear 0-1 to output (stride 3).
 * Input and output may be the same array for in-place mapping.
 */
export type ToneMappingBatchFn = (input: Float32Array, output: Float32Array, pixelCount: number) => void;

import type { LinearColorSpace } from '../color/colorSpaces.js';

export interface ApplyToneMappingOptions {
  toneMapping?: ToneMappingType;
  exposure?: number;
  /** EXR metadata (e.g. from FloatImageData.metadata) for color space validation */
  metadata?: Record<string, unknown>;
  /** Source linear color space. When not linear-rec709, data is converted before tone mapping */
  sourceColorSpace?: LinearColorSpace;
}
