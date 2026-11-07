/**
 * Transfer functions: linear ↔ display-referred.
 * sRGB and Display P3 use the same IEC 61966-2-1 curve.
 * Rec. 2020 display (SDR) uses BT.1886 / 2.4 gamma.
 */

import type { DisplayColorSpace } from './colorSpaces.js';
import { linearTosRGB, sRGBToLinear } from './srgb.js';

/** sRGB linear segment threshold (≈0.04045 in sRGB space) */
const LINEAR_SRGB_KNEELOW = 0.0031308;

/** 1/2.4 — Rec. 2020 gamma exponent (avoid division in hot path) */
const REC2020_GAMMA = 1 / 2.4;
/** 1/12.92 — linear segment scale (avoid division in hot path) */
const REC2020_LINEAR_SCALE = 1 / 12.92;
/** 1/1.055 — display segment scale (avoid division in hot path) */
const REC2020_DISPLAY_SCALE = 1 / 1.055;

/**
 * Rec. 2020 / BT.1886 display: linear to 2.4 gamma.
 * EOTF^-1 for SDR Rec. 2020.
 */
function linearToRec2020Display(x: number): number {
  if (x <= LINEAR_SRGB_KNEELOW) {
    return x * 12.92;
  }
  return 1.055 * x ** REC2020_GAMMA - 0.055;
}

/**
 * Rec. 2020 / BT.1886 display: 2.4 gamma to linear.
 * EOTF for SDR Rec. 2020.
 */
function rec2020DisplayToLinear(x: number): number {
  if (x <= 0.04045) {
    return x * REC2020_LINEAR_SCALE;
  }
  return ((x + 0.055) * REC2020_DISPLAY_SCALE) ** 2.4;
}

/**
 * Convert linear RGB to display-referred.
 * sRGB and Display P3 use the same transfer (IEC 61966-2-1).
 */
export function linearToDisplay(r: number, g: number, b: number, space: DisplayColorSpace): [number, number, number] {
  switch (space) {
    case 'display-srgb':
    case 'display-p3':
      return [linearTosRGB(r), linearTosRGB(g), linearTosRGB(b)];
    case 'display-rec2020':
      return [linearToRec2020Display(r), linearToRec2020Display(g), linearToRec2020Display(b)];
    default: {
      const _: never = space;
      return [r, g, b];
    }
  }
}

/**
 * Convert display-referred RGB to linear.
 */
export function displayToLinear(r: number, g: number, b: number, space: DisplayColorSpace): [number, number, number] {
  switch (space) {
    case 'display-srgb':
    case 'display-p3':
      return [sRGBToLinear(r), sRGBToLinear(g), sRGBToLinear(b)];
    case 'display-rec2020':
      return [rec2020DisplayToLinear(r), rec2020DisplayToLinear(g), rec2020DisplayToLinear(b)];
    default: {
      const _: never = space;
      return [r, g, b];
    }
  }
}
/** SMPTE ST 2084 EOTF. Returns absolute luminance in nits; mirrors negative values like libjxl. */
export function pqToNits(value: number): number {
  const p = Math.abs(value) ** (1 / (2523 / 32));
  return Math.sign(value) * 10000 * (Math.max(0, p - 3424 / 4096) / (2413 / 128 - (2392 / 128) * p)) ** (16384 / 2610);
}

/** Inverse ST 2084, accepting absolute luminance in nits. */
export function nitsToPq(value: number): number {
  const p = (Math.abs(value) / 10000) ** (2610 / 16384);
  return Math.sign(value) * ((3424 / 4096 + (2413 / 128) * p) / (1 + (2392 / 128) * p)) ** (2523 / 32);
}
/** ARIB STD-B67 inverse OETF: HLG code values to scene light (before the RGB-dependent OOTF). */
export function hlgToScene(value: number): number {
  const a = Math.abs(value);
  return Math.sign(value) * (a <= 0.5 ? (a * a) / 3 : (Math.exp((a - 0.55991073) / 0.17883277) + 0.28466892) / 12);
}

/** ARIB STD-B67 OETF, with sign-preserving extension. */
export function sceneToHlg(value: number): number {
  const a = Math.abs(value);
  return Math.sign(value) * (a <= 1 / 12 ? Math.sqrt(3 * a) : 0.17883277 * Math.log(12 * a - 0.28466892) + 0.55991073);
}

/** libjxl/BT.2100 HLG scene-to-display OOTF, in-place on interleaved RGBA. Alpha is untouched. */
export function applyHlgOotf(data: Float32Array, intensityTarget: number, luminances: readonly number[]): void {
  if (295 <= intensityTarget && intensityTarget <= 305) return;
  const gamma = 1.2 * 1.111 ** Math.log2(intensityTarget / 1000);
  for (let i = 0; i < data.length; i += 4) {
    const y = data[i]! * luminances[0]! + data[i + 1]! * luminances[1]! + data[i + 2]! * luminances[2]!;
    const ratio = y ** (gamma - 1);
    if (!Number.isFinite(ratio)) continue;
    let r = data[i]! * ratio,
      g = data[i + 1]! * ratio,
      b = data[i + 2]! * ratio;
    const peak = Math.max(r, g, b);
    if (gamma < 1 && peak > 1) {
      r /= peak;
      g /= peak;
      b /= peak;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}
