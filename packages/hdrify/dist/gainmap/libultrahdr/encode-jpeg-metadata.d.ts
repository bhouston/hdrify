import type { GainMapFormat } from '../readJpegGainMap.js';
import type { CompressedImage, GainMapMetadata } from '../types.js';
export interface EncodeJPEGMetadataOptions {
    format?: GainMapFormat;
    /** ICC profile (APP2 payload). For ultrahdr, default is sRGB matching reference memorial.jpg. Pass null to omit. */
    icc?: Uint8Array | null;
    /** EXIF (APP1 payload). For ultrahdr, default is null (no EXIF, matches reference). Pass Uint8Array to add. */
    exif?: Uint8Array | null;
}
export declare function encodeJPEGMetadata(encodingResult: GainMapMetadata & {
    sdr: CompressedImage;
    gainMap: CompressedImage;
}, options?: EncodeJPEGMetadataOptions): Uint8Array;
