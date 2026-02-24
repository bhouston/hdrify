import { encodeToJpeg } from './jpegEncoder.js';
import { encodeJPEGMetadata } from './libultrahdr/encode-jpeg-metadata.js';
/**
 * Write encoding result as a single JPEG-R file (JPEG with embedded gain map).
 */
export function writeJpegGainMap(encodingResult, options = {}) {
    const quality = options.quality ?? 90;
    const format = options.format ?? 'ultrahdr';
    const sdrCompressed = encodeToJpeg(encodingResult.sdr, encodingResult.width, encodingResult.height, quality);
    const gainMapCompressed = encodeToJpeg(encodingResult.gainMap, encodingResult.width, encodingResult.height, quality);
    return encodeJPEGMetadata({
        ...encodingResult.metadata,
        sdr: sdrCompressed,
        gainMap: gainMapCompressed,
    }, { format, icc: options.icc, exif: options.exif });
}
/**
 * Write encoding result as separate files: SDR JPEG, gain map JPEG, and metadata JSON.
 */
export function writeGainMapAsSeparateFiles(encodingResult, options = {}) {
    const quality = options.quality ?? 90;
    const sdrImage = encodeToJpeg(encodingResult.sdr, encodingResult.width, encodingResult.height, quality).data;
    const gainMapImage = encodeToJpeg(encodingResult.gainMap, encodingResult.width, encodingResult.height, quality).data;
    return {
        sdrImage,
        gainMapImage,
        metadata: encodingResult.metadata,
    };
}
//# sourceMappingURL=writeJpegGainMap.js.map