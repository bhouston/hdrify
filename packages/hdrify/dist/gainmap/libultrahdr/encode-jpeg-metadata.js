import { assembleJpegAdobeGainMap } from '../adobeGainMapAssembler.js';
import { DEFAULT_ICC_PROFILE } from './defaultIccProfile.js';
import { assembleJpegWithGainMap } from './jpeg-assembler.js';
export function encodeJPEGMetadata(encodingResult, options = {}) {
    const format = options.format ?? 'ultrahdr';
    if (encodingResult.sdr.mimeType !== 'image/jpeg') {
        throw new Error('This function expects an SDR image compressed in jpeg');
    }
    if (encodingResult.gainMap.mimeType !== 'image/jpeg') {
        throw new Error('This function expects a GainMap image compressed in jpeg');
    }
    const metadata = {
        version: '1.0',
        gainMapMin: encodingResult.gainMapMin,
        gainMapMax: encodingResult.gainMapMax,
        gamma: encodingResult.gamma,
        offsetSdr: encodingResult.offsetSdr,
        offsetHdr: encodingResult.offsetHdr,
        hdrCapacityMin: encodingResult.hdrCapacityMin,
        hdrCapacityMax: encodingResult.hdrCapacityMax,
        minContentBoost: Array.isArray(encodingResult.gainMapMin)
            ? 2 ** (encodingResult.gainMapMin.reduce((a, b) => a + b, 0) / encodingResult.gainMapMin.length)
            : 2 ** encodingResult.gainMapMin,
        maxContentBoost: Array.isArray(encodingResult.gainMapMax)
            ? 2 ** (encodingResult.gainMapMax.reduce((a, b) => a + b, 0) / encodingResult.gainMapMax.length)
            : 2 ** encodingResult.gainMapMax,
    };
    if (format === 'adobe-gainmap') {
        return assembleJpegAdobeGainMap({
            sdr: encodingResult.sdr,
            gainMap: encodingResult.gainMap,
            metadata,
        });
    }
    const icc = options.icc !== undefined ? options.icc : DEFAULT_ICC_PROFILE;
    const exif = options.exif ?? null;
    return assembleJpegWithGainMap({
        sdr: encodingResult.sdr,
        gainMap: encodingResult.gainMap,
        metadata,
        ...(exif && exif.length > 0 && { exif }),
        ...(icc && icc.length > 0 && { icc }),
    });
}
//# sourceMappingURL=encode-jpeg-metadata.js.map