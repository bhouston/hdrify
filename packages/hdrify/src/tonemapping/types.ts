export type ToneMappingType = 'aces' | 'reinhard' | 'neutral' | 'agx';

export type ToneMappingFn = (r: number, g: number, b: number) => [number, number, number];

import type { LinearColorSpace } from '../color/colorSpaces.js';

export interface ApplyToneMappingOptions {
  toneMapping?: ToneMappingType;
  exposure?: number;
  /** EXR metadata (e.g. from FloatImageData.metadata) for color space validation */
  metadata?: Record<string, unknown>;
  /** Source linear color space. When not linear-rec709, data is converted before tone mapping */
  sourceColorSpace?: LinearColorSpace;
}
