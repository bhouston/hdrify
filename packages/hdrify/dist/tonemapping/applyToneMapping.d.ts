import type { ApplyToneMappingOptions } from './types.js';
/**
 * Apply full HDR-to-LDR tone mapping pipeline.
 *
 * Input: Float32Array RGBA. Output: Uint8Array RGB in sRGB (IEC 61966-2-1).
 * Pipeline: (optional color space conversion) → exposure → tone mapping (linear 0-1) → linearToSrgb → 0-255
 * Mutates hdrData in-place (sanitizes to non-negative finite) before processing.
 * Uses batch mappers with a single reusable buffer to minimize allocations.
 */
export declare function applyToneMapping(hdrData: Float32Array, width: number, height: number, options?: ApplyToneMappingOptions): Uint8Array;
