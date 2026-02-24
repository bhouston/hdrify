import './ensureBuffer.js';
import type { CompressedImage } from './types.js';
/**
 * Encode RGBA image data to JPEG using jpeg-js.
 */
export declare function encodeToJpeg(data: Uint8ClampedArray, width: number, height: number, quality?: number): CompressedImage;
