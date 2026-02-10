// FloatImageData - shared type

// EXR
export { readExr } from './exr/readExr.js';
export type { WriteExrOptions } from './exr/writeExr.js';
export { writeExr } from './exr/writeExr.js';
export type { FloatImageData } from './floatImage.js';
// Gainmap
export { encodeGainMap } from './gainmap/gainMapEncoder.js';
export { encodeToJpeg } from './gainmap/jpegEncoder.js';
export type {
  CompressedImage,
  EncodingResult,
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
export type { CreateHsvRainbowImageOptions } from './synthetic/createHsvRainbowImage.js';
export { createHsvRainbowImage } from './synthetic/createHsvRainbowImage.js';
export { applyToneMapping } from './tonemapping/applyToneMapping.js';
export { getToneMapping } from './tonemapping/mappers.js';
export type { ApplyToneMappingOptions, ToneMappingFn, ToneMappingType } from './tonemapping/types.js';
