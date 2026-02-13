// FloatImageData - shared type

// Color (sRGB ↔ linear, IEC 61966-2-1; use on float [0,1] after bytes→float)
export { linearTosRGB, sRGBToLinear } from './color/srgb.js';
// EXR
export { readExr } from './exr/readExr.js';
export type { WriteExrOptions } from './exr/writeExr.js';
export { writeExr } from './exr/writeExr.js';
export type { FloatImageData } from './floatImage.js';
// Gainmap
export { decodeGainMap } from './gainmap/decodeGainMap.js';
export type { DecodeGainMapOptions } from './gainmap/decodeGainMap.js';
export { encodeGainMap } from './gainmap/gainMapEncoder.js';
export { encodeToJpeg } from './gainmap/jpegEncoder.js';
export { readJpegGainMap } from './gainmap/readJpegGainMap.js';
export type { GainMapFormat } from './gainmap/readJpegGainMap.js';
export { decodeGainMapFromFloatEncoding } from './gainmap/decodeGainMap.js';
export { encodeGainMapToFloat } from './gainmap/gainMapEncoder.js';
export type {
  CompressedImage,
  EncodingResult,
  EncodingResultFloat,
  GainMapEncodingOptions,
  GainMapMetadata,
  GainMapMetadataExtended,
} from './gainmap/types.js';
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