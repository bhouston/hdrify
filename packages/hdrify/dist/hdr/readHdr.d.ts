import { type HdrifyImage } from '../hdrifyImage.js';
import type { ToneMappingType } from '../tonemapping/types.js';
export interface HDRToLDROptions {
    /** Tone mapping: 'aces' or 'reinhard' (default: 'reinhard') */
    toneMapping?: ToneMappingType;
    /** Exposure value for tone mapping (default: 1.0) */
    exposure?: number;
}
export interface ParseHDROptions {
    /** When true (default), require exact #?RADIANCE magic token. When false, accept any #?<programtype> */
    headerStrict?: boolean;
    /** 'raw' (default): return pixel values as stored. 'physicalRadiance': divide by EXPOSURE for physical radiance */
    output?: 'raw' | 'physicalRadiance';
}
/**
 * Read an HDR (Radiance) file buffer and return image data
 *
 * Implementation based on Three.js HDRLoader, adapted from:
 * http://www.graphics.cornell.edu/~bjw/rgbe.html
 *
 * @param hdrBuffer - Uint8Array containing HDR file data
 * @param options - Parse options (headerStrict, output)
 * @returns Parsed HDR image data with dimensions and pixel data as HdrifyImage
 */
export declare function readHdr(hdrBuffer: Uint8Array, options?: ParseHDROptions): HdrifyImage;
/**
 * Convert HDR float data to LDR (Low Dynamic Range) uint8 data using tone mapping
 *
 * Uses unified tone mapping (Reinhard or ACES) with sRGB output transfer.
 *
 * @param hdrData - Float32Array of RGBA pixel data [R, G, B, A, R, G, B, A, ...] where A is always 1.0
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param options - Tone mapping options (toneMapping, exposure)
 * @returns Uint8Array containing uint8 RGB data in sRGB, ready for image encoding
 */
export declare function hdrToLdr(hdrData: Float32Array, width: number, height: number, options?: HDRToLDROptions): Uint8Array;
/**
 * Convert an HDR file buffer to LDR RGB buffer
 *
 * This is a convenience function that combines parsing and conversion.
 * Output is sRGB.
 *
 * @param hdrBuffer - Uint8Array containing HDR file data
 * @param options - Tone mapping options (toneMapping, exposure)
 * @returns Object containing width, height, and LDR RGB buffer
 */
export declare function convertHDRToLDR(hdrBuffer: Uint8Array, options?: HDRToLDROptions): {
    width: number;
    height: number;
    ldrData: Uint8Array;
};
