import { describe, expect, it } from 'vitest';
import { encodeJPEGMetadata } from './encode-jpeg-metadata.js';
const validMetadata = {
    gainMapMin: [0, 0, 0],
    gainMapMax: [2, 2, 2],
    gamma: [1, 1, 1],
    offsetSdr: [1 / 64, 1 / 64, 1 / 64],
    offsetHdr: [1 / 64, 1 / 64, 1 / 64],
    hdrCapacityMin: 0,
    hdrCapacityMax: 2,
};
const validJpeg = {
    data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    mimeType: 'image/jpeg',
    width: 1,
    height: 1,
};
describe('encodeJPEGMetadata', () => {
    it('should throw when SDR mimeType is not image/jpeg', () => {
        const invalidSdr = {
            ...validJpeg,
            mimeType: 'image/png',
        };
        expect(() => encodeJPEGMetadata({
            ...validMetadata,
            sdr: invalidSdr,
            gainMap: validJpeg,
        })).toThrow('This function expects an SDR image compressed in jpeg');
    });
    it('should throw when gainMap mimeType is not image/jpeg', () => {
        const invalidGainMap = {
            ...validJpeg,
            mimeType: 'image/png',
        };
        expect(() => encodeJPEGMetadata({
            ...validMetadata,
            sdr: validJpeg,
            gainMap: invalidGainMap,
        })).toThrow('This function expects a GainMap image compressed in jpeg');
    });
});
//# sourceMappingURL=encode-jpeg-metadata.test.js.map