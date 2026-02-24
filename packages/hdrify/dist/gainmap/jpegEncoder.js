import './ensureBuffer.js';
import { encode as jpegEncode } from 'jpeg-js';
/**
 * Encode RGBA image data to JPEG using jpeg-js.
 */
export function encodeToJpeg(data, width, height, quality = 90) {
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
//# sourceMappingURL=jpegEncoder.js.map