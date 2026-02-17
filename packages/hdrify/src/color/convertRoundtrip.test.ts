/**
 * Round-trip tests for color space conversion.
 *
 * We create simple gradients (red-to-black, green-to-black, blue-to-black),
 * convert to another space and back, and assert every pixel matches the
 * original within the stated tolerance (zero failures).
 *
 * - Linear ↔ linear: 1% relative error (validates RGB↔XYZ matrices).
 * - Linear → display → linear: 1% relative error (validates transfer functions).
 */

import { describe, expect, it } from 'vitest';
import { compareImages } from '../synthetic/compareImages.js';
import type { GradientChannel } from '../synthetic/createGradientImage.js';
import { createGradientImage } from '../synthetic/createGradientImage.js';
import type { LinearColorSpace } from './colorSpaces.js';
import { LINEAR_TO_DISPLAY } from './colorSpaces.js';
import { convertDisplayToLinear, convertLinearColorSpace, convertLinearToDisplay } from './convert.js';

const LINEAR_ROUNDTRIP_TOLERANCE = 0.01; // 1% - every pixel must match
const DISPLAY_ROUNDTRIP_TOLERANCE = 0.01; // 1% - for linear → display → linear
const GRADIENT_WIDTH = 32;
const GRADIENT_HEIGHT = 4;

/** Red-to-black, green-to-black, blue-to-black in linear Rec.709 */
const GRADIENT_CHANNELS: GradientChannel[] = ['r', 'g', 'b'];

/** Linear space pairs: convert A → B → A and compare to original. */
const LINEAR_ROUNDTRIP_PAIRS: [LinearColorSpace, LinearColorSpace][] = [
  ['linear-rec709', 'linear-p3'],
  ['linear-rec709', 'linear-rec2020'],
  ['linear-p3', 'linear-rec2020'],
];

function makeGradient(channel: GradientChannel) {
  return createGradientImage({
    width: GRADIENT_WIDTH,
    height: GRADIENT_HEIGHT,
    mode: 'horizontal',
    min: 0,
    max: 1,
    channel,
  });
}

describe('linear color space round-trip', () => {
  for (const [fromSpace, toSpace] of LINEAR_ROUNDTRIP_PAIRS) {
    describe(`${fromSpace} → ${toSpace} → ${fromSpace}`, () => {
      for (const channel of GRADIENT_CHANNELS) {
        it(`${channel}-to-black gradient round-trips within 1%`, () => {
          const original = makeGradient(channel);
          const inFromSpace =
            original.linearColorSpace === fromSpace ? original : convertLinearColorSpace(original, fromSpace);

          const toOther = convertLinearColorSpace(inFromSpace, toSpace);
          const back = convertLinearColorSpace(toOther, fromSpace);

          const result = compareImages(inFromSpace, back, {
            toleranceRelative: LINEAR_ROUNDTRIP_TOLERANCE,
            toleranceAbsolute: 1e-6,
            includeMismatchSamples: 5,
          });

          expect(result.match, roundtripMessage(result, channel, fromSpace, toSpace)).toBe(true);
        });
      }
    });
  }
});

describe('linear → display → linear round-trip', () => {
  for (const linearSpace of ['linear-rec709', 'linear-p3', 'linear-rec2020'] as const) {
    const displaySpace = LINEAR_TO_DISPLAY[linearSpace];
    describe(`${linearSpace} → ${displaySpace} → ${linearSpace}`, () => {
      for (const channel of GRADIENT_CHANNELS) {
        it(`${channel}-to-black gradient round-trips within 1%`, () => {
          const original = makeGradient(channel);
          const inLinearSpace =
            original.linearColorSpace === linearSpace ? original : convertLinearColorSpace(original, linearSpace);

          const displayImage = convertLinearToDisplay(inLinearSpace, displaySpace);
          const back = convertDisplayToLinear(
            displayImage.data,
            displayImage.width,
            displayImage.height,
            displaySpace,
            linearSpace,
          );

          const result = compareImages(inLinearSpace, back, {
            toleranceRelative: DISPLAY_ROUNDTRIP_TOLERANCE,
            toleranceAbsolute: 1e-6,
            includeMismatchSamples: 5,
          });

          expect(result.match, roundtripMessage(result, channel, linearSpace, displaySpace)).toBe(true);
        });
      }
    });
  }
});

function roundtripMessage(
  result: {
    match: boolean;
    maxAbsoluteDelta?: number;
    mismatchedPixels?: number;
    mismatchSamples?: Array<{ expected: [number, number, number, number]; actual: [number, number, number, number] }>;
  },
  channel: string,
  from: string,
  to: string,
): string {
  if (result.match) return '';
  const parts = [
    `Round-trip ${from} → ${to} → ${from} for ${channel}-to-black gradient failed.`,
    `Mismatched pixels: ${result.mismatchedPixels ?? '?'}, max absolute delta: ${result.maxAbsoluteDelta ?? '?'}.`,
  ];
  const sample = result.mismatchSamples?.[0];
  if (sample) {
    parts.push(`Sample: expected [${sample.expected.join(', ')}], actual [${sample.actual.join(', ')}].`);
  }
  return parts.join(' ');
}
