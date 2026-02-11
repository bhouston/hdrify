import { describe, expect, it } from 'vitest';
import { encodeJPEGMetadata } from './encode-jpeg-metadata.js';
import type { CompressedImage } from '../types.js';

const validMetadata = {
  gainMapMin: [0, 0, 0] as [number, number, number],
  gainMapMax: [2, 2, 2] as [number, number, number],
  gamma: [1, 1, 1] as [number, number, number],
  offsetSdr: [1 / 64, 1 / 64, 1 / 64] as [number, number, number],
  offsetHdr: [1 / 64, 1 / 64, 1 / 64] as [number, number, number],
  hdrCapacityMin: 0,
  hdrCapacityMax: 2,
};

const validJpeg: CompressedImage = {
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
    } as unknown as CompressedImage;

    expect(() =>
      encodeJPEGMetadata({
        ...validMetadata,
        sdr: invalidSdr,
        gainMap: validJpeg,
      }),
    ).toThrow('This function expects an SDR image compressed in jpeg');
  });

  it('should throw when gainMap mimeType is not image/jpeg', () => {
    const invalidGainMap = {
      ...validJpeg,
      mimeType: 'image/png',
    } as unknown as CompressedImage;

    expect(() =>
      encodeJPEGMetadata({
        ...validMetadata,
        sdr: validJpeg,
        gainMap: invalidGainMap,
      }),
    ).toThrow('This function expects a GainMap image compressed in jpeg');
  });
});
