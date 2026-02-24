import type { GainMapFormat } from './readJpegGainMap.js';
import type { EncodingResult, GainMapMetadata } from './types.js';
export interface GainMapWriterOptions {
    /** JPEG quality 0-100. Default: 90 */
    quality?: number;
    /** Output format: ultrahdr (default) or adobe-gainmap */
    format?: GainMapFormat;
    /** ICC profile (APP2 payload). For ultrahdr, default is sRGB matching reference memorial.jpg. Pass null to omit. */
    icc?: Uint8Array | null;
    /** EXIF (APP1 payload). For ultrahdr, default is null (no EXIF, matches reference). Pass Uint8Array to add. */
    exif?: Uint8Array | null;
}
/**
 * Write encoding result as a single JPEG-R file (JPEG with embedded gain map).
 */
export declare function writeJpegGainMap(encodingResult: EncodingResult, options?: GainMapWriterOptions): Uint8Array;
export interface SeparateFilesResult {
    sdrImage: Uint8Array;
    gainMapImage: Uint8Array;
    metadata: GainMapMetadata;
}
/**
 * Write encoding result as separate files: SDR JPEG, gain map JPEG, and metadata JSON.
 */
export declare function writeGainMapAsSeparateFiles(encodingResult: EncodingResult, options?: GainMapWriterOptions): SeparateFilesResult;
