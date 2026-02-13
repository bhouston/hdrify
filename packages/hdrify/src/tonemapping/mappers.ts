/**
 * Pure TypeScript tone mapping implementations.
 * Ported from gainmap-js SDRMaterial GLSL.
 *
 * All mappers output linear 0-1. Callers apply linearToSrgb for display (matches Three.js).
 * Batch API: input/output Float32Array with stride 3 per pixel.
 */

import {
  applyMatrix3,
  LINEAR_REC709_TO_LINEAR_REC2020,
  LINEAR_REC2020_TO_LINEAR_REC709,
  mat3ToArray,
} from '../color/matrixConversion.js';
import type { ToneMappingBatchFn, ToneMappingType } from './types.js';

/** Color space of tone mapper output: 'linear' or 'srgb'. */
export type ColorSpace = 'linear' | 'srgb';

/** RRTAndODTFit for ACES */
function RRTAndODTFit(v: number): number {
  const a = v * (v + 0.0245786) - 0.000090537;
  const bVal = v * (0.983729 * v + 0.432951) + 0.238081;
  return a / bVal;
}

/**
 * ACES Filmic tone mapping - matches gainmap-js default.
 * Input: linear RGB (callers ensure non-negative finite). Output: linear 0-1.
 */
function acesFilmicBatch(input: Float32Array, output: Float32Array, pixelCount: number): void {
  // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by pixelCount loop
  const m00 = 0.59719,
    m01 = 0.35458,
    m02 = 0.04823;
  const m10 = 0.076,
    m11 = 0.90834,
    m12 = 0.01566;
  const m20 = 0.0284,
    m21 = 0.13383,
    m22 = 0.83777;
  const o00 = 1.60475,
    o01 = -0.53108,
    o02 = -0.07367;
  const o10 = -0.10208,
    o11 = 1.10813,
    o12 = -0.00605;
  const o20 = -0.00327,
    o21 = -0.07276,
    o22 = 1.07602;

  for (let i = 0; i < pixelCount; i++) {
    const si = i * 3;
    const r = input[si]!;
    const g = input[si + 1]!;
    const b = input[si + 2]!;

    const r1 = m00 * r + m01 * g + m02 * b;
    const g1 = m10 * r + m11 * g + m12 * b;
    const b1 = m20 * r + m21 * g + m22 * b;

    const r2 = RRTAndODTFit(r1);
    const g2 = RRTAndODTFit(g1);
    const b2 = RRTAndODTFit(b1);

    output[si] = o00 * r2 + o01 * g2 + o02 * b2;
    output[si + 1] = o10 * r2 + o11 * g2 + o12 * b2;
    output[si + 2] = o20 * r2 + o21 * g2 + o22 * b2;
  }
  // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by pixelCount loop
}

/**
 * Reinhard tone mapping: x / (1 + x). Output: linear 0-1.
 */
function reinhardBatch(input: Float32Array, output: Float32Array, pixelCount: number): void {
  // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by pixelCount loop
  for (let i = 0; i < pixelCount; i++) {
    const si = i * 3;
    const r = input[si]!;
    const g = input[si + 1]!;
    const b = input[si + 2]!;
    output[si] = r / (1 + r);
    output[si + 1] = g / (1 + g);
    output[si + 2] = b / (1 + b);
  }
  // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by pixelCount loop
}

/**
 * Khronos Neutral tone mapping - https://modelviewer.dev/examples/tone-mapping
 */
function neutralBatch(input: Float32Array, output: Float32Array, pixelCount: number): void {
  // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by pixelCount loop
  const StartCompression = 0.8 - 0.04;
  const Desaturation = 0.15;

  for (let i = 0; i < pixelCount; i++) {
    const si = i * 3;
    let r0 = input[si]!;
    let g0 = input[si + 1]!;
    let b0 = input[si + 2]!;

    const x = Math.min(r0, Math.min(g0, b0));
    const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;

    r0 -= offset;
    g0 -= offset;
    b0 -= offset;

    const peak = Math.max(r0, Math.max(g0, b0));

    if (peak < StartCompression) {
      output[si] = r0;
      output[si + 1] = g0;
      output[si + 2] = b0;
      continue;
    }

    const d = 1.0 - StartCompression;
    const newPeak = 1.0 - (d * d) / (peak + d - StartCompression);

    r0 *= newPeak / peak;
    g0 *= newPeak / peak;
    b0 *= newPeak / peak;

    const gMix = 1.0 - 1.0 / (Desaturation * (peak - newPeak) + 1.0);

    output[si] = r0 * (1 - gMix) + newPeak * gMix;
    output[si + 1] = g0 * (1 - gMix) + newPeak * gMix;
    output[si + 2] = b0 * (1 - gMix) + newPeak * gMix;
  }
  // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by pixelCount loop
}

function agxDefaultContrastApprox(x: number): number {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

const LINEAR_REC709_TO_REC2020 = mat3ToArray(LINEAR_REC709_TO_LINEAR_REC2020);
const LINEAR_REC2020_TO_REC709 = mat3ToArray(LINEAR_REC2020_TO_LINEAR_REC709);

const AgXInsetMatrix: [number, number, number, number, number, number, number, number, number] = [
  0.856627153315983, 0.0951212405381588, 0.0482516061458583, 0.137318972929847, 0.761241990602591, 0.101439036467562,
  0.11189821299995, 0.0767994186031903, 0.811302368396859,
];

const AgXOutsetMatrix: [number, number, number, number, number, number, number, number, number] = [
  1.1271005818144368, -0.11060664309660323, -0.016493938717834573, -0.1413297634984383, 1.157823702216272,
  -0.016493938717834257, -0.14132976349843826, -0.11060664309660294, 1.2519364065950405,
];

const AgxMinEv = -12.47393;
const AgxMaxEv = 4.026069;

/**
 * AgX tone mapping from Blender via Filament.
 */
const agxVecIn: [number, number, number] = [0, 0, 0];
const agxVecOut: [number, number, number] = [0, 0, 0];

function agxBatch(input: Float32Array, output: Float32Array, pixelCount: number): void {
  // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by pixelCount loop
  for (let i = 0; i < pixelCount; i++) {
    const si = i * 3;
    agxVecIn[0] = input[si]!;
    agxVecIn[1] = input[si + 1]!;
    agxVecIn[2] = input[si + 2]!;

    applyMatrix3(LINEAR_REC709_TO_REC2020, agxVecIn, agxVecOut);
    let r = agxVecOut[0]!;
    let g = agxVecOut[1]!;
    let b = agxVecOut[2]!;

    applyMatrix3(AgXInsetMatrix, agxVecOut, agxVecIn);
    r = agxVecIn[0]!;
    g = agxVecIn[1]!;
    b = agxVecIn[2]!;

    r = Math.max(r, 1e-10);
    g = Math.max(g, 1e-10);
    b = Math.max(b, 1e-10);

    const divisor = 1 / (AgxMaxEv - AgxMinEv);
    r = Math.max(0, Math.min(1, (Math.log2(r) - AgxMinEv) * divisor));
    g = Math.max(0, Math.min(1, (Math.log2(g) - AgxMinEv) * divisor));
    b = Math.max(0, Math.min(1, (Math.log2(b) - AgxMinEv) * divisor));

    r = agxDefaultContrastApprox(r);
    g = agxDefaultContrastApprox(g);
    b = agxDefaultContrastApprox(b);

    agxVecIn[0] = r;
    agxVecIn[1] = g;
    agxVecIn[2] = b;
    applyMatrix3(AgXOutsetMatrix, agxVecIn, agxVecOut);
    r = agxVecOut[0]!;
    g = agxVecOut[1]!;
    b = agxVecOut[2]!;

    r = Math.max(0, r) ** 2.2;
    g = Math.max(0, g) ** 2.2;
    b = Math.max(0, b) ** 2.2;

    agxVecIn[0] = r;
    agxVecIn[1] = g;
    agxVecIn[2] = b;
    applyMatrix3(LINEAR_REC2020_TO_REC709, agxVecIn, agxVecOut);

    output[si] = agxVecOut[0]!;
    output[si + 1] = agxVecOut[1]!;
    output[si + 2] = agxVecOut[2]!;
  }
  // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by pixelCount loop
}

const TONE_MAPPING_MAP: Record<ToneMappingType, ToneMappingBatchFn> = {
  aces: acesFilmicBatch,
  reinhard: reinhardBatch,
  neutral: neutralBatch,
  agx: agxBatch,
};

export function getToneMapping(type: ToneMappingType): ToneMappingBatchFn {
  return TONE_MAPPING_MAP[type];
}
