import type { FloatImageData } from './floatImage.js';

const PRECISION = 6;

function round(val: number): number {
  return Math.round(val * 10 ** PRECISION) / 10 ** PRECISION;
}

/**
 * Compute MIN_VALUE, MAX_VALUE, RANGE, and AVG_VALUE from RGB channels in a single pass.
 * Adds these to the returned metadata object.
 */
export function addRangeMetadata(image: FloatImageData): Record<string, unknown> {
  const { data } = image;
  let minR = Infinity;
  let minG = Infinity;
  let minB = Infinity;
  let maxR = -Infinity;
  let maxG = -Infinity;
  let maxB = -Infinity;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let i = 0; i + 2 < data.length; i += 4) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;

    minR = Math.min(minR, r);
    minG = Math.min(minG, g);
    minB = Math.min(minB, b);
    maxR = Math.max(maxR, r);
    maxG = Math.max(maxG, g);
    maxB = Math.max(maxB, b);
    sumR += r;
    sumG += g;
    sumB += b;
    count++;
  }

  const minR_ = count === 0 ? 0 : minR;
  const minG_ = count === 0 ? 0 : minG;
  const minB_ = count === 0 ? 0 : minB;
  const maxR_ = count === 0 ? 0 : maxR;
  const maxG_ = count === 0 ? 0 : maxG;
  const maxB_ = count === 0 ? 0 : maxB;
  const avgR = count === 0 ? 0 : sumR / count;
  const avgG = count === 0 ? 0 : sumG / count;
  const avgB = count === 0 ? 0 : sumB / count;

  return {
    MIN_VALUE: [round(minR_), round(minG_), round(minB_)],
    MAX_VALUE: [round(maxR_), round(maxG_), round(maxB_)],
    RANGE: [round(maxR_ - minR_), round(maxG_ - minG_), round(maxB_ - minB_)],
    AVG_VALUE: [round(avgR), round(avgG), round(avgB)],
  };
}
