/**
 * In-memory encode → decode round-trip tests (no JPEG).
 *
 * Decode does not need to know the tone mapper: the gain map stores the ratio
 * (HDR_linear / SDR_linear) per pixel, so recovery is (linearize SDR) * gain.
 * We test incrementally: float-only (no quantization), then add SDR quantization,
 * then full quantization, to isolate where precision is lost.
 *
 * Tolerance: compareFloatImages uses decimal 0.01 = 1%. We keep tolerances tight.
 */

import { describe, expect, it } from 'vitest';
import type { FloatImageData } from '../floatImage.js';
import { compareFloatImages } from '../synthetic/compareFloatImages.js';
import { createGradientImage } from '../synthetic/createGradientImage.js';
import { createHsvRainbowImage } from '../synthetic/createHsvRainbowImage.js';
import { decodeGainMap, decodeGainMapFromFloatEncoding } from './decodeGainMap.js';
import { encodeGainMap, encodeGainMapToFloat } from './gainMapEncoder.js';
import { quantizeRgbaFloatToU8 } from './quantize.js';
import { decodeGainMapCpu } from './readJpegGainMap/decodeGainMapCpu.js';

/** Result of validating a horizontal gradient (min→max) line-by-line. */
interface SlowGradientValidationResult {
  failures: { x: number; y: number; intensity: number; decodedR: number; error: number }[];
  maxError: number;
  firstFailureX: number | null;
  /** Per-x worst error (one entry per column) for reporting intensity range */
  byX: Map<number, { intensity: number; decodedR: number; error: number }>;
  sortedXs: number[];
}

/** Compute per-column max error for a horizontal gradient (for banding diagnosis). */
function worstColumnsByError(
  original: FloatImageData,
  decoded: FloatImageData,
  width: number,
  height: number,
  min: number,
  max: number,
  topN: number,
): { x: number; intensity: number; maxError: number }[] {
  const columnErrors = new Map<number, number>();
  for (let x = 0; x < width; x++) {
    let maxErr = 0;
    for (let y = 0; y < height; y++) {
      const p = (y * width + x) * 4;
      const err = Math.abs((decoded.data[p] ?? 0) - (original.data[p] ?? 0));
      if (err > maxErr) maxErr = err;
    }
    columnErrors.set(x, maxErr);
  }
  const sorted = [...columnErrors.entries()]
    .map(([x]) => {
      const t = width > 1 ? x / (width - 1) : 0;
      return { x, intensity: min + t * (max - min), maxError: columnErrors.get(x) ?? 0 };
    })
    .sort((a, b) => b.maxError - a.maxError);
  return sorted.slice(0, topN);
}

function validateSlowGradientLineByLine(
  original: FloatImageData,
  decoded: FloatImageData,
  width: number,
  height: number,
  min: number,
  max: number,
  toleranceRelative: number,
  toleranceAbsolute: number,
): SlowGradientValidationResult {
  const refThreshold = 0.01;
  const failures: { x: number; y: number; intensity: number; decodedR: number; error: number }[] = [];
  let maxError = 0;
  let firstFailureX: number | null = null;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const expectedR = original.data[p] ?? 0;
      const actualR = decoded.data[p] ?? 0;
      const error = Math.abs(actualR - expectedR);
      if (error > maxError) maxError = error;
      const ref = Math.max(Math.abs(expectedR), Math.abs(actualR));
      const allowed = ref < refThreshold ? toleranceAbsolute : ref * toleranceRelative;
      const t = width > 1 ? x / (width - 1) : 0;
      const intensity = min + t * (max - min);
      if (error > allowed) {
        if (firstFailureX === null) firstFailureX = x;
        failures.push({ x, y, intensity, decodedR: actualR, error });
      }
    }
  }

  const byX = new Map<number, { intensity: number; decodedR: number; error: number }>();
  for (const f of failures) {
    const existing = byX.get(f.x);
    if (!existing || f.error > existing.error)
      byX.set(f.x, { intensity: f.intensity, decodedR: f.decodedR, error: f.error });
  }
  const sortedXs = [...byX.keys()].sort((a, b) => a - b);
  return { failures, maxError, firstFailureX, byX, sortedXs };
}

function slowGradientFailureMessage(result: SlowGradientValidationResult): string {
  const { byX, sortedXs, failures, maxError, firstFailureX } = result;
  const firstX = sortedXs[0];
  const lastX = sortedXs[sortedXs.length - 1];
  const intensityAtFirst = firstX !== undefined ? (byX.get(firstX)?.intensity ?? null) : null;
  const intensityRange =
    firstX !== undefined && lastX !== undefined ? [byX.get(firstX)?.intensity, byX.get(lastX)?.intensity] : null;
  const sample = sortedXs
    .slice(0, 12)
    .map(
      (x) =>
        `x=${x} i≈${(byX.get(x)?.intensity ?? 0).toFixed(3)} dec=${(byX.get(x)?.decodedR ?? 0).toFixed(3)} err=${(byX.get(x)?.error ?? 0).toFixed(4)}`,
    )
    .join('; ');
  return (
    `Slow gradient: ${failures.length} pixels failed (maxError=${maxError}). ` +
    `First failure at x=${firstFailureX} (intensity≈${intensityAtFirst?.toFixed(4)}). ` +
    `Failure range intensity≈${intensityRange?.map((v) => v?.toFixed(4)).join('–')}. ` +
    `Sample: ${sample}`
  );
}

describe('gain map in-memory round-trip (encode → decode, no JPEG)', () => {
  /** Tight tolerance for float-only round-trip (no quantization). logRecovery is clamped to [0,1] so extremes can have error. */
  const TOLERANCE_FLOAT_ONLY = { toleranceRelative: 0.005, toleranceAbsolute: 0.003 };

  /** After quantizing SDR only: error dominated by 0.5/255 in sRGB then linearized. */
  const TOLERANCE_SDR_QUANTIZED = { toleranceRelative: 0.01, toleranceAbsolute: 0.003 };

  /** Full pipeline (SDR + gain map quantized): both 8-bit steps. */
  const TOLERANCE_FULL = { toleranceRelative: 0.005, toleranceAbsolute: 0.002 };

  it('single pixel float round-trip: exact recovery (no clamping)', () => {
    const original = {
      width: 1,
      height: 1,
      linearColorSpace: 'linear-rec709' as const,
      data: new Float32Array([2, 2, 2, 1]),
    } satisfies FloatImageData;
    const encoding = encodeGainMapToFloat(original, { toneMapping: 'reinhard' });
    const decoded = decodeGainMapFromFloatEncoding(encoding);
    expect(decoded.data[0]).toBeCloseTo(2, 5);
    expect(decoded.data[1]).toBeCloseTo(2, 5);
    expect(decoded.data[2]).toBeCloseTo(2, 5);
    expect(decoded.data[3]).toBeCloseTo(1, 5);
  });

  it('float-only encode → decode matches original within 0.5% (no quantization)', () => {
    const original = createHsvRainbowImage({
      width: 16,
      height: 16,
      value: 0.9,
      intensity: 4,
    });
    const encoding = encodeGainMapToFloat(original, { toneMapping: 'reinhard' });
    const decoded = decodeGainMapFromFloatEncoding(encoding);

    const result = compareFloatImages(original, decoded, TOLERANCE_FLOAT_ONLY);
    expect(
      result.match,
      `Float-only round-trip: maxAbsoluteDelta=${result.maxAbsoluteDelta} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });

  it('float-only gradient (HDR range) matches within 0.5%', () => {
    const original = createGradientImage({
      width: 8,
      height: 8,
      mode: 'horizontal',
      min: 0.1,
      max: 8,
    });
    const encoding = encodeGainMapToFloat(original, { toneMapping: 'reinhard' });
    const decoded = decodeGainMapFromFloatEncoding(encoding);

    const result = compareFloatImages(original, decoded, TOLERANCE_FLOAT_ONLY);
    expect(
      result.match,
      `Float-only gradient: maxAbsoluteDelta=${result.maxAbsoluteDelta} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });

  it('decode is tone-map-agnostic: aces vs reinhard both round-trip (float)', () => {
    const original = createGradientImage({
      width: 4,
      height: 4,
      mode: 'horizontal',
      min: 0.2,
      max: 4,
    });
    const encReinhard = encodeGainMapToFloat(original, { toneMapping: 'reinhard' });
    const encAces = encodeGainMapToFloat(original, { toneMapping: 'aces' });

    const decReinhard = decodeGainMapFromFloatEncoding(encReinhard);
    const decAces = decodeGainMapFromFloatEncoding(encAces);

    const resR = compareFloatImages(original, decReinhard, TOLERANCE_FLOAT_ONLY);
    const resA = compareFloatImages(original, decAces, TOLERANCE_FLOAT_ONLY);
    expect(resR.match).toBe(true);
    expect(resA.match).toBe(true);
  });

  it('SDR quantized only (gain map float): round-trip within 1%', () => {
    const original = createHsvRainbowImage({
      width: 16,
      height: 16,
      value: 0.9,
      intensity: 4,
    });
    const encoding = encodeGainMapToFloat(original, { toneMapping: 'reinhard' });
    const sdrU8 = quantizeRgbaFloatToU8(encoding.sdrFloat);
    const decoded = decodeGainMapCpu(sdrU8, encoding.gainMapFloat, encoding.width, encoding.height, encoding.metadata);

    const result = compareFloatImages(original, decoded, TOLERANCE_SDR_QUANTIZED);
    expect(
      result.match,
      `SDR quantized round-trip: maxAbsoluteDelta=${result.maxAbsoluteDelta} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });

  it('full encode (quantized) → decode: rainbow within 0.5%', () => {
    const original = createHsvRainbowImage({
      width: 32,
      height: 32,
      value: 0.9,
      intensity: 4,
    });
    const encoding = encodeGainMap(original, { toneMapping: 'reinhard' });
    const decoded = decodeGainMap(encoding);

    const result = compareFloatImages(original, decoded, TOLERANCE_FULL);
    expect(
      result.match,
      `Full round-trip: maxAbsoluteDelta=${result.maxAbsoluteDelta} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });

  it('full encode → decode: gradient (HDR range) within 0.5%', () => {
    const original = createGradientImage({
      width: 16,
      height: 16,
      mode: 'horizontal',
      min: 0.1,
      max: 8,
    });
    const encoding = encodeGainMap(original, { toneMapping: 'reinhard' });
    const decoded = decodeGainMap(encoding);

    const result = compareFloatImages(original, decoded, TOLERANCE_FULL);
    expect(
      result.match,
      `Full gradient: maxAbsoluteDelta=${result.maxAbsoluteDelta} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });

  it('full encode → decode: low DR (intensity 1) within 0.5%', () => {
    const original = createHsvRainbowImage({
      width: 24,
      height: 24,
      value: 0.9,
      intensity: 1,
    });
    const encoding = encodeGainMap(original, { toneMapping: 'reinhard' });
    const decoded = decodeGainMap(encoding);

    const result = compareFloatImages(original, decoded, TOLERANCE_FULL);
    expect(
      result.match,
      `Low-DR round-trip: maxAbsoluteDelta=${result.maxAbsoluteDelta} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });

  /**
   * Slow gradient 0.05 → 1.5 validated pixel-by-pixel to locate banding/boundary errors
   * (e.g. around sRGB knee ~0.04 or other thresholds). Uses float-only path to isolate
   * encode/decode math from quantization.
   */
  it('slow gradient 0.05–1.5: line-by-line validation (float-only)', () => {
    const width = 256;
    const height = 4;
    const min = 0.05;
    const max = 1.5;
    const original = createGradientImage({
      width,
      height,
      mode: 'horizontal',
      min,
      max,
    });
    const encoding = encodeGainMapToFloat(original, { toneMapping: 'reinhard' });
    const decoded = decodeGainMapFromFloatEncoding(encoding);

    const result = validateSlowGradientLineByLine(original, decoded, width, height, min, max, 0.01, 0.005);
    expect(result.failures.length, slowGradientFailureMessage(result)).toBe(0);
  });

  /**
   * Same slow gradient through full quantized pipeline (SDR + gain map 8-bit).
   * 2% tolerance (8-bit quantization compounds); on failure the message reports which intensity range has the worst errors.
   */
  it('slow gradient 0.05–1.5: line-by-line validation (full quantized)', () => {
    const width = 256;
    const height = 4;
    const min = 0.05;
    const max = 1.5;
    const original = createGradientImage({
      width,
      height,
      mode: 'horizontal',
      min,
      max,
    });
    const encoding = encodeGainMap(original, { toneMapping: 'reinhard' });
    const decoded = decodeGainMap(encoding);

    const result = validateSlowGradientLineByLine(original, decoded, width, height, min, max, 0.02, 0.005);
    const worstCols = worstColumnsByError(original, decoded, width, height, min, max, 15);
    const worstColsStr = worstCols
      .map((c) => `intensity≈${c.intensity.toFixed(3)} (x=${c.x}) err=${c.maxError.toFixed(4)}`)
      .join('; ');
    expect(
      result.failures.length,
      `${slowGradientFailureMessage(result)} Worst columns by error: ${worstColsStr}`,
    ).toBe(0);
  });
});
