/**
 * Validate that EXR image chromaticities match Rec. 709 before tone mapping.
 * Tone mapping assumes Rec. 709 / sRGB primaries.
 */

import type { FloatImageData } from '../floatImage.js';

/** Rec. 709 chromaticities (red, green, blue, white D65) */
const REC709_RED = { x: 0.64, y: 0.33 };
const REC709_GREEN = { x: 0.3, y: 0.6 };
const REC709_BLUE = { x: 0.15, y: 0.06 };
const REC709_WHITE = { x: 0.3127, y: 0.329 };

const TOLERANCE = 0.01;

export interface Chromaticities {
  redX: number;
  redY: number;
  greenX: number;
  greenY: number;
  blueX: number;
  blueY: number;
  whiteX: number;
  whiteY: number;
}

function isRec709(ch: Chromaticities): boolean {
  return (
    Math.abs(ch.redX - REC709_RED.x) <= TOLERANCE &&
    Math.abs(ch.redY - REC709_RED.y) <= TOLERANCE &&
    Math.abs(ch.greenX - REC709_GREEN.x) <= TOLERANCE &&
    Math.abs(ch.greenY - REC709_GREEN.y) <= TOLERANCE &&
    Math.abs(ch.blueX - REC709_BLUE.x) <= TOLERANCE &&
    Math.abs(ch.blueY - REC709_BLUE.y) <= TOLERANCE &&
    Math.abs(ch.whiteX - REC709_WHITE.x) <= TOLERANCE &&
    Math.abs(ch.whiteY - REC709_WHITE.y) <= TOLERANCE
  );
}

export interface ValidateToneMappingColorSpaceOptions {
  /** When true, throw if chromaticities are absent (default: false, allow absent) */
  strict?: boolean;
}

/**
 * Validate that metadata chromaticities match Rec. 709 before tone mapping.
 * If chromaticities are present and do not match, throws a descriptive error.
 *
 * @param metadata - EXR header metadata with optional chromaticities
 * @throws Error when chromaticities are present and do not match Rec. 709
 */
export function validateToneMappingColorSpaceFromMetadata(
  metadata: Record<string, unknown> | undefined,
  options: ValidateToneMappingColorSpaceOptions = {},
): void {
  if (!metadata) return;

  const chromaticities = metadata.chromaticities as Chromaticities | undefined;

  if (!chromaticities) {
    if (options.strict) {
      throw new Error(
        'EXR file has no chromaticities attribute. Tone mapping assumes Rec. 709 / sRGB primaries. Use strict: false to allow images without chromaticities, or ensure the EXR declares chromaticities.',
      );
    }
    return;
  }

  const ch = chromaticities as Chromaticities;
  if (
    typeof ch.redX !== 'number' ||
    typeof ch.redY !== 'number' ||
    typeof ch.greenX !== 'number' ||
    typeof ch.greenY !== 'number' ||
    typeof ch.blueX !== 'number' ||
    typeof ch.blueY !== 'number' ||
    typeof ch.whiteX !== 'number' ||
    typeof ch.whiteY !== 'number'
  ) {
    return; // Malformed chromaticities, skip validation
  }

  if (!isRec709(ch)) {
    throw new Error(
      'EXR chromaticities (red, green, blue, white) do not match Rec. 709. Tone mapping assumes Rec. 709 / sRGB primaries. ' +
        'Use an image with Rec. 709 chromaticities or convert color space before tone mapping.',
    );
  }
}

/**
 * Validate that image chromaticities match Rec. 709 before tone mapping.
 * If chromaticities are present and do not match, throws a descriptive error.
 *
 * @param image - FloatImageData with optional metadata.chromaticities from EXR
 * @throws Error when chromaticities are present and do not match Rec. 709
 */
export function validateToneMappingColorSpace(
  image: FloatImageData,
  options: ValidateToneMappingColorSpaceOptions = {},
): void {
  validateToneMappingColorSpaceFromMetadata(image.metadata, options);
}
