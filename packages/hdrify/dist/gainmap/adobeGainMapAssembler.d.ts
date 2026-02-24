/**
 * Adobe-style gain map assembler.
 * Produces a simpler layout: primary SDR JPEG + second SOI + gain map JPEG with hdrgm XMP.
 * No MPF, no Container:Directory. Matches the second-SOI structure that readJpegGainMap expects.
 */
import type { CompressedImage, GainMapMetadataExtended } from './types.js';
export interface AdobeGainMapAssembleOptions {
    sdr: CompressedImage;
    gainMap: CompressedImage;
    metadata: GainMapMetadataExtended;
}
/**
 * Assemble Adobe gain map format: primary JPEG (unchanged) + second SOI + gain map with hdrgm XMP.
 */
export declare function assembleJpegAdobeGainMap(options: AdobeGainMapAssembleOptions): Uint8Array;
