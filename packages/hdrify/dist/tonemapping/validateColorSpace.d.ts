/**
 * Validate that EXR image chromaticities match Rec. 709 before tone mapping.
 * Tone mapping assumes Rec. 709 / sRGB primaries.
 * When sourceColorSpace is passed to applyToneMapping, conversion is used instead of validation.
 */
import { type Chromaticities } from '../color/chromaticities.js';
import type { HdrifyImage } from '../hdrifyImage.js';
export type { Chromaticities };
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
export declare function validateToneMappingColorSpaceFromMetadata(metadata: Record<string, unknown> | undefined, options?: ValidateToneMappingColorSpaceOptions): void;
/**
 * Validate that image chromaticities match Rec. 709 before tone mapping.
 * If chromaticities are present and do not match, throws a descriptive error.
 *
 * @param image - HdrifyImage with optional metadata.chromaticities from EXR
 * @throws Error when chromaticities are present and do not match Rec. 709
 */
export declare function validateToneMappingColorSpace(image: HdrifyImage, options?: ValidateToneMappingColorSpaceOptions): void;
