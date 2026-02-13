// FloatImageData - shared type

export {
  CANVAS_DISPLAY_COLOR_SPACES,
  type CanvasPredefinedColorSpace,
  getCanvasColorSpaceForDisplay,
} from './color/canvasColorSpace.js';
// Color space and conversion
export {
  CHROMATICITIES_P3,
  CHROMATICITIES_REC709,
  CHROMATICITIES_REC2020,
} from './color/chromaticities.js';
export {
  chromaticitiesToLinearColorSpace,
  DISPLAY_COLOR_SPACES,
  DISPLAY_TO_CHROMATICITIES,
  DISPLAY_TO_LINEAR,
  type DisplayColorSpace,
  LINEAR_COLOR_SPACES,
  LINEAR_TO_CHROMATICITIES,
  LINEAR_TO_DISPLAY,
  type LinearColorSpace,
} from './color/colorSpaces.js';
export {
  convertDisplayToLinear,
  convertFloat32ToLinearColorSpace,
  convertLinearColorSpace,
  convertLinearToDisplay,
} from './color/convert.js';
// Color (sRGB ↔ linear, IEC 61966-2-1; use on float [0,1] after bytes→float)
export { linearTosRGB, sRGBToLinear } from './color/srgb.js';
// EXR
export { readExr } from './exr/readExr.js';
export type { WriteExrOptions } from './exr/writeExr.js';
export { writeExr } from './exr/writeExr.js';
export { ensureNonNegativeFinite, type FloatImageData } from './floatImage.js';
export type { DecodeGainMapOptions } from './gainmap/decodeGainMap.js';
// Gainmap
export { decodeGainMap, decodeGainMapFromFloatEncoding } from './gainmap/decodeGainMap.js';
export { encodeGainMap, encodeGainMapToFloat } from './gainmap/gainMapEncoder.js';
export { encodeToJpeg } from './gainmap/jpegEncoder.js';
export type { GainMapFormat } from './gainmap/readJpegGainMap.js';
export { readJpegGainMap } from './gainmap/readJpegGainMap.js';
export type {
  CompressedImage,
  EncodingResult,
  EncodingResultFloat,
  GainMapEncodingOptions,
  GainMapMetadata,
  GainMapMetadataExtended,
} from './gainmap/types.js';
export { DEFAULT_ICC_PROFILE } from './gainmap/libultrahdr/defaultIccProfile.js';
export type { GainMapWriterOptions, SeparateFilesResult } from './gainmap/writeJpegGainMap.js';
export { writeGainMapAsSeparateFiles, writeJpegGainMap } from './gainmap/writeJpegGainMap.js';
// HDR
export type { HDRToLDROptions, ParseHDROptions } from './hdr/readHdr.js';
export { convertHDRToLDR, hdrToLdr, readHdr } from './hdr/readHdr.js';
export { writeHdr } from './hdr/writeHdr.js';
export { addRangeMetadata } from './rangeMetadata.js';
export type {
  CompareFloatImagesOptions,
  CompareFloatImagesResult,
  MismatchSample,
} from './synthetic/compareFloatImages.js';
// Synthetic test images
export { compareFloatImages } from './synthetic/compareFloatImages.js';
export type { CreateGradientImageOptions, GradientChannel, GradientMode } from './synthetic/createGradientImage.js';
export { createGradientImage } from './synthetic/createGradientImage.js';
export type { CreateHsvRainbowImageOptions } from './synthetic/createHsvRainbowImage.js';
export { createHsvRainbowImage } from './synthetic/createHsvRainbowImage.js';
export { applyToneMapping } from './tonemapping/applyToneMapping.js';
export { getToneMapping } from './tonemapping/mappers.js';
export type { ApplyToneMappingOptions, ToneMappingFn, ToneMappingType } from './tonemapping/types.js';
export type { Chromaticities, ValidateToneMappingColorSpaceOptions } from './tonemapping/validateColorSpace.js';
export {
  validateToneMappingColorSpace,
  validateToneMappingColorSpaceFromMetadata,
} from './tonemapping/validateColorSpace.js';
