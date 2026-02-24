/**
 * JPEG assembler for creating JPEG-R (JPEG with gain map) files
 * Based on libultrahdr jpegr.cpp implementation
 */
import type { CompressedImage, GainMapMetadataExtended } from '../types.js';
export interface AssembleJpegOptions {
    sdr: CompressedImage;
    gainMap: CompressedImage;
    metadata: GainMapMetadataExtended;
    exif?: Uint8Array;
    icc?: Uint8Array;
}
export declare function assembleJpegWithGainMap(options: AssembleJpegOptions): Uint8Array;
