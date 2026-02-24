/**
 * Pure TypeScript tone mapping implementations.
 * Ported from gainmap-js SDRMaterial GLSL.
 *
 * All mappers output linear 0-1. Callers apply linearToSrgb for display (matches Three.js).
 * Batch API: input/output Float32Array with stride 3 per pixel.
 */
import type { ToneMappingBatchFn, ToneMappingType } from './types.js';
/** Color space of tone mapper output: 'linear' or 'srgb'. */
export type ColorSpace = 'linear' | 'srgb';
export declare function getToneMapping(type: ToneMappingType): ToneMappingBatchFn;
