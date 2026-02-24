/**
 * HDR (Radiance RGBE) file writer
 *
 * Writes HDR files from HdrifyImage
 * Implements the Radiance RGBE encoding format
 */
import { type HdrifyImage } from '../hdrifyImage.js';
/**
 * Write an HDR file buffer from HdrifyImage
 *
 * @param HdrifyImage - HdrifyImage containing image dimensions and pixel data
 * @returns Uint8Array containing HDR file data
 */
export declare function writeHdr(hdrifyImage: HdrifyImage): Uint8Array;
