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
  const r0 = r > 0 && Number.isFinite(r) ? r : 0;
  const g0 = g > 0 && Number.isFinite(g) ? g : 0;
  const b0 = b > 0 && Number.isFinite(b) ? b : 0;

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
  const r1 = m00 * r0 + m01 * g0 + m02 * b0;
  const g1 = m10 * r0 + m11 * g0 + m12 * b0;
  const b1 = m20 * r0 + m21 * g0 + m22 * b0;

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

/**
 * Khronos Neutral tone mapping - https://modelviewer.dev/examples/tone-mapping
 * Preserves neutral greys and provides smooth shoulder compression.
 */
function neutral(r: number, g: number, b: number): [number, number, number] {
  let r0 = r > 0 && Number.isFinite(r) ? r : 0;
  let g0 = g > 0 && Number.isFinite(g) ? g : 0;
  let b0 = b > 0 && Number.isFinite(b) ? b : 0;

  const StartCompression = 0.8 - 0.04;
  const Desaturation = 0.15;

  const x = Math.min(r0, Math.min(g0, b0));
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;

  r0 -= offset;
  g0 -= offset;
  b0 -= offset;

  const peak = Math.max(r0, Math.max(g0, b0));

  if (peak < StartCompression) {
    return saturate3(r0, g0, b0);
  }

  const d = 1.0 - StartCompression;
  const newPeak = 1.0 - (d * d) / (peak + d - StartCompression);

  r0 *= newPeak / peak;
  g0 *= newPeak / peak;
  b0 *= newPeak / peak;

  const gMix = 1.0 - 1.0 / (Desaturation * (peak - newPeak) + 1.0);

  const rOut = r0 * (1 - gMix) + newPeak * gMix;
  const gOut = g0 * (1 - gMix) + newPeak * gMix;
  const bOut = b0 * (1 - gMix) + newPeak * gMix;

  return saturate3(rOut, gOut, bOut);
}

/** AgX default contrast sigmoid approximation - https://iolite-engine.com/blog_posts/minimal_agx_implementation */
function agxDefaultContrastApprox(x: number): number {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

/**
 * AgX tone mapping from Blender via Filament.
 * Uses rec 2020 primaries, log2 encoding, and sigmoid contrast.
 * https://github.com/google/filament/pull/7236
 * Inputs and outputs: Linear sRGB.
 */
function agx(r: number, g: number, b: number): [number, number, number] {
  const r0 = r > 0 && Number.isFinite(r) ? r : 0;
  const g0 = g > 0 && Number.isFinite(g) ? g : 0;
  const b0 = b > 0 && Number.isFinite(b) ? b : 0;

  // sRGB => linear Rec 2020 (row-major, from Three.js)
  const LINEAR_SRGB_TO_LINEAR_REC2020: Mat3 = [
    [0.6274, 0.3293, 0.0433],
    [0.0691, 0.9195, 0.0113],
    [0.0164, 0.088, 0.8956],
  ];

  type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];
  const mvm = (m: Mat3, v: [number, number, number]): [number, number, number] => [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];

  // AgX inset matrix (row-major; rows = columns of GLSL mat3 so neutral stays neutral)
  const AgXInsetMatrix: Mat3 = [
    [0.856627153315983, 0.0951212405381588, 0.0482516061458583],
    [0.137318972929847, 0.761241990602591, 0.101439036467562],
    [0.11189821299995, 0.0767994186031903, 0.811302368396859],
  ];

  // AgX outset matrix (row-major; rows = columns of GLSL mat3 so neutral stays neutral)
  const AgXOutsetMatrix: Mat3 = [
    [1.1271005818144368, -0.11060664309660323, -0.016493938717834573],
    [-0.1413297634984383, 1.157823702216272, -0.016493938717834257],
    [-0.14132976349843826, -0.11060664309660294, 1.2519364065950405],
  ];

  // Rec 2020 => sRGB (row-major; rows chosen so (1,1,1) maps to (1,1,1))
  const LINEAR_REC2020_TO_LINEAR_SRGB: Mat3 = [
    [1.6605, -0.5876, -0.0728],
    [-0.1246, 1.1329, -0.0083],
    [-0.0182, -0.1006, 1.1187],
  ];

  const AgxMinEv = -12.47393;
  const AgxMaxEv = 4.026069;

  let [r1, g1, b1] = mvm(LINEAR_SRGB_TO_LINEAR_REC2020, [r0, g0, b0]);
  [r1, g1, b1] = mvm(AgXInsetMatrix, [r1, g1, b1]);

  r1 = Math.max(r1, 1e-10);
  g1 = Math.max(g1, 1e-10);
  b1 = Math.max(b1, 1e-10);

  r1 = Math.max(0, Math.min(1, (Math.log2(r1) - AgxMinEv) / (AgxMaxEv - AgxMinEv)));
  g1 = Math.max(0, Math.min(1, (Math.log2(g1) - AgxMinEv) / (AgxMaxEv - AgxMinEv)));
  b1 = Math.max(0, Math.min(1, (Math.log2(b1) - AgxMinEv) / (AgxMaxEv - AgxMinEv)));

  r1 = agxDefaultContrastApprox(r1);
  g1 = agxDefaultContrastApprox(g1);
  b1 = agxDefaultContrastApprox(b1);

  [r1, g1, b1] = mvm(AgXOutsetMatrix, [r1, g1, b1]);

  r1 = Math.max(0, r1) ** 2.2;
  g1 = Math.max(0, g1) ** 2.2;
  b1 = Math.max(0, b1) ** 2.2;

  [r1, g1, b1] = mvm(LINEAR_REC2020_TO_LINEAR_SRGB, [r1, g1, b1]);

  return saturate3(r1, g1, b1);
}

export function getToneMapping(type: ToneMappingType): ToneMappingFn {
  // biome-ignore lint/nursery/noUnnecessaryConditions: exhaustive switch over union type
  switch (type) {
    case 'aces':
      return acesFilmic;
    case 'reinhard':
      return reinhard;
    case 'neutral':
      return neutral;
    case 'agx':
      return agx;
    default:
      return acesFilmic;
  }
}
