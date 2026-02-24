/**
 * EXR (OpenEXR) file reader
 *
 * Extracted and adapted from Three.js EXRLoader
 * Supports PIZ, ZIP, RLE, and uncompressed EXR files
 */
import { type HdrifyImage } from '../hdrifyImage.js';
/**
 * Read an EXR file buffer and return HdrifyImage
 *
 * @param exrBuffer - Uint8Array containing EXR file data
 * @returns Parsed EXR image data with dimensions and pixel data as HdrifyImage
 */
export declare function readExr(exrBuffer: Uint8Array): HdrifyImage;
