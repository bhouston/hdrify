/**
 * EXR (OpenEXR) file writer
 *
 * Writes EXR files from HdrifyImage.
 * Orchestrates header builder, offset table, and scan block modules.
 * Supports NO_COMPRESSION, RLE, ZIP, ZIPS.
 */
import { type HdrifyImage } from '../hdrifyImage.js';
export interface WriteExrOptions {
    /** Compression: 0=none, 1=RLE, 2=ZIPS, 3=ZIP, 4=PIZ, 5=PXR24 */
    compression?: number;
}
/**
 * Write an EXR file buffer from HdrifyImage
 *
 * @param HdrifyImage - HdrifyImage containing image dimensions and pixel data
 * @param options - Optional compression (default: zip; use piz for broader compatibility)
 * @returns Uint8Array containing EXR file data
 */
export declare function writeExr(hdrifyImage: HdrifyImage, options?: WriteExrOptions): Uint8Array;
