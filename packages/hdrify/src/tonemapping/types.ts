export type ToneMappingType = 'aces' | 'reinhard';

export type ToneMappingFn = (r: number, g: number, b: number) => [number, number, number];

export interface ApplyToneMappingOptions {
  toneMapping?: ToneMappingType;
  exposure?: number;
  gamma?: number;
}
