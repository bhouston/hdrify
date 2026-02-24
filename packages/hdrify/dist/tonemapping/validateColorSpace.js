/**
 * Validate that EXR image chromaticities match Rec. 709 before tone mapping.
 * Tone mapping assumes Rec. 709 / sRGB primaries.
 * When sourceColorSpace is passed to applyToneMapping, conversion is used instead of validation.
 */
import { CHROMATICITIES_REC709 } from '../color/chromaticities.js';
const TOLERANCE = 0.01;
function isRec709(ch) {
    const r = CHROMATICITIES_REC709;
    return (Math.abs(ch.redX - r.redX) <= TOLERANCE &&
        Math.abs(ch.redY - r.redY) <= TOLERANCE &&
        Math.abs(ch.greenX - r.greenX) <= TOLERANCE &&
        Math.abs(ch.greenY - r.greenY) <= TOLERANCE &&
        Math.abs(ch.blueX - r.blueX) <= TOLERANCE &&
        Math.abs(ch.blueY - r.blueY) <= TOLERANCE &&
        Math.abs(ch.whiteX - r.whiteX) <= TOLERANCE &&
        Math.abs(ch.whiteY - r.whiteY) <= TOLERANCE);
}
/**
 * Validate that metadata chromaticities match Rec. 709 before tone mapping.
 * If chromaticities are present and do not match, throws a descriptive error.
 *
 * @param metadata - EXR header metadata with optional chromaticities
 * @throws Error when chromaticities are present and do not match Rec. 709
 */
export function validateToneMappingColorSpaceFromMetadata(metadata, options = {}) {
    if (!metadata)
        return;
    const chromaticities = metadata.chromaticities;
    if (!chromaticities) {
        if (options.strict) {
            throw new Error('EXR file has no chromaticities attribute. Tone mapping assumes Rec. 709 / sRGB primaries. Use strict: false to allow images without chromaticities, or ensure the EXR declares chromaticities.');
        }
        return;
    }
    const ch = chromaticities;
    if (typeof ch.redX !== 'number' ||
        typeof ch.redY !== 'number' ||
        typeof ch.greenX !== 'number' ||
        typeof ch.greenY !== 'number' ||
        typeof ch.blueX !== 'number' ||
        typeof ch.blueY !== 'number' ||
        typeof ch.whiteX !== 'number' ||
        typeof ch.whiteY !== 'number') {
        return; // Malformed chromaticities, skip validation
    }
    if (!isRec709(ch)) {
        throw new Error('EXR chromaticities (red, green, blue, white) do not match Rec. 709. Tone mapping assumes Rec. 709 / sRGB primaries. ' +
            'Use an image with Rec. 709 chromaticities or convert color space before tone mapping.');
    }
}
/**
 * Validate that image chromaticities match Rec. 709 before tone mapping.
 * If chromaticities are present and do not match, throws a descriptive error.
 *
 * @param image - HdrifyImage with optional metadata.chromaticities from EXR
 * @throws Error when chromaticities are present and do not match Rec. 709
 */
export function validateToneMappingColorSpace(image, options = {}) {
    validateToneMappingColorSpaceFromMetadata(image.metadata, options);
}
//# sourceMappingURL=validateColorSpace.js.map