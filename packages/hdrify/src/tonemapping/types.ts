export type ToneMappingType = 'aces' | 'reinhard' | 'neutral' | 'agx';

export type ToneMappingFn = (r: number, g: number, b: number) => [number, number, number];

export interface ApplyToneMappingOptions {
  toneMapping?: ToneMappingType;
  exposure?: number;
  /** EXR metadata (e.g. from FloatImageData.metadata) for color space validation */
  metadata?: Record<string, unknown>;
}
