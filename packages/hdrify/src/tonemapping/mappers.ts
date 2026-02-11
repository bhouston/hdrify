/**
 * Pure TypeScript tone mapping implementations.
 * Ported from gainmap-js SDRMaterial GLSL.
 */

import type { ToneMappingFn, ToneMappingType } from './types.js';

function saturate(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function saturate3(r: number, g: number, b: number): [number, number, number] {
  return [saturate(r), saturate(g), saturate(b)];
}

/**
 * ACES Filmic tone mapping - matches gainmap-js default.
 * Input: linear RGB, Output: sRGB 0-1
 */
function acesFilmic(r: number, g: number, b: number): [number, number, number] {
  // Clamp negative and non-finite inputs - tonemappers assume non-negative HDR
  r = r > 0 && Number.isFinite(r) ? r : 0;
  g = g > 0 && Number.isFinite(g) ? g : 0;
  b = b > 0 && Number.isFinite(b) ? b : 0;

  // ACESInputMat (sRGB => AP1) - row-major, from Stephen Hill's BakingLab
  const m00 = 0.59719;
  const m01 = 0.35458;
  const m02 = 0.04823;
  const m10 = 0.076;
  const m11 = 0.90834;
  const m12 = 0.01566;
  const m20 = 0.0284;
  const m21 = 0.13383;
  const m22 = 0.83777;
  const r1 = m00 * r + m01 * g + m02 * b;
  const g1 = m10 * r + m11 * g + m12 * b;
  const b1 = m20 * r + m21 * g + m22 * b;

  // RRTAndODTFit
  const RRTAndODTFit = (v: number) => {
    if (!Number.isFinite(v) || v < 0) return 0;
    const a = v * (v + 0.0245786) - 0.000090537;
    const bVal = v * (0.983729 * v + 0.432951) + 0.238081;
    return a / bVal;
  };
  const r2 = RRTAndODTFit(r1);
  const g2 = RRTAndODTFit(g1);
  const b2 = RRTAndODTFit(b1);

  // ACESOutputMat (AP1 => sRGB) - row-major, from Stephen Hill's BakingLab
  const o00 = 1.60475;
  const o01 = -0.53108;
  const o02 = -0.07367;
  const o10 = -0.10208;
  const o11 = 1.10813;
  const o12 = -0.00605;
  const o20 = -0.00327;
  const o21 = -0.07276;
  const o22 = 1.07602;
  const r3 = o00 * r2 + o01 * g2 + o02 * b2;
  const g3 = o10 * r2 + o11 * g2 + o12 * b2;
  const b3 = o20 * r2 + o21 * g2 + o22 * b2;

  return saturate3(r3, g3, b3);
}

/**
 * Reinhard tone mapping: x / (1 + x)
 * Uses max(0,x) to avoid discontinuity at zero for negative inputs.
 */
function reinhard(r: number, g: number, b: number): [number, number, number] {
  const sr = r > 0 && Number.isFinite(r) ? r : 0;
  const sg = g > 0 && Number.isFinite(g) ? g : 0;
  const sb = b > 0 && Number.isFinite(b) ? b : 0;
  return saturate3(sr / (1 + sr), sg / (1 + sg), sb / (1 + sb));
}

export function getToneMapping(type: ToneMappingType): ToneMappingFn {
  // biome-ignore lint/nursery/noUnnecessaryConditions: exhaustive switch over union type
  switch (type) {
    case 'aces':
      return acesFilmic;
    case 'reinhard':
      return reinhard;
    default:
      return acesFilmic;
  }
}
