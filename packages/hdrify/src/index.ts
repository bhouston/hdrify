// FloatImageData - shared type

// EXR
export { parseEXRFile } from './exr/exrReader.js';
export { writeEXRFile } from './exr/exrWriter.js';
export type { FloatImageData } from './floatImage.js';
// Gainmap
export { encodeGainMap } from './gainmap/gainMapEncoder.js';
export type { GainMapWriterOptions, SeparateFilesResult } from './gainmap/gainMapWriter.js';
export { writeGainMapAsJPEGR, writeGainMapAsSeparateFiles } from './gainmap/gainMapWriter.js';
export { encodeToJpeg } from './gainmap/jpegEncoder.js';
export type {
  CompressedImage,
  EncodingResult,
  GainMapEncodingOptions,
  GainMapMetadata,
  GainMapMetadataExtended,
  ToneMappingType,
} from './gainmap/types.js';
// HDR
export type { HDRImageData, HDRToLDROptions, ParseHDROptions } from './hdr/hdrReader.js';
export { convertHDRToLDR, hdrToLdr, parseHDRFile } from './hdr/hdrReader.js';
export { writeHDRFile } from './hdr/hdrWriter.js';
