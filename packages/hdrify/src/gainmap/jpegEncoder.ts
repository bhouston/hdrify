import { encode as jpegEncode } from 'jpeg-js';
import type { CompressedImage } from './types.js';

/**
 * Encode RGBA image data to JPEG using jpeg-js.
 */
export function encodeToJpeg(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  quality: number = 90,
): CompressedImage {
  const rawImageData = {
    data: data instanceof Uint8ClampedArray ? new Uint8Array(data) : data,
    width,
    height,
  };
  const encoded = jpegEncode(rawImageData, quality);
  return {
    data: encoded.data,
    mimeType: 'image/jpeg',
    width,
    height,
  };
}
