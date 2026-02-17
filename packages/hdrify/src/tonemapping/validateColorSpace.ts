/**
 * Validate that EXR image chromaticities match Rec. 709 before tone mapping.
 * Tone mapping assumes Rec. 709 / sRGB primaries.
 * When sourceColorSpace is passed to applyToneMapping, conversion is used instead of validation.
 */

import { CHROMATICITIES_REC709, type Chromaticities } from '../color/chromaticities.js';
import type { HdrifyImage } from '../hdrifyImage.js';

const TOLERANCE = 0.01;

export type { Chromaticities };

function isRec709(ch: Chromaticities): boolean {
  const r = CHROMATICITIES_REC709;
  return (
    Math.abs(ch.redX - r.redX) <= TOLERANCE &&
    Math.abs(ch.redY - r.redY) <= TOLERANCE &&
    Math.abs(ch.greenX - r.greenX) <= TOLERANCE &&
    Math.abs(ch.greenY - r.greenY) <= TOLERANCE &&
    Math.abs(ch.blueX - r.blueX) <= TOLERANCE &&
    Math.abs(ch.blueY - r.blueY) <= TOLERANCE &&
    Math.abs(ch.whiteX - r.whiteX) <= TOLERANCE &&
    Math.abs(ch.whiteY - r.whiteY) <= TOLERANCE
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
 * @param image - HdrifyImage with optional metadata.chromaticities from EXR
 * @throws Error when chromaticities are present and do not match Rec. 709
 */
export function validateToneMappingColorSpace(
  image: HdrifyImage,
  options: ValidateToneMappingColorSpaceOptions = {},
): void {
  validateToneMappingColorSpaceFromMetadata(image.metadata, options);
}
