import { describe, expect, it } from 'vitest';
import { encodeGainMap } from './gainMapEncoder.js';
import { writeGainMapAsSeparateFiles, writeJpegGainMap } from './writeJpegGainMap.js';

const smallImage = {
  width: 4,
  height: 4,
  data: new Float32Array(4 * 4 * 4).fill(1),
};
// Set some variation for proper encoding
smallImage.data.set([2, 2, 2, 1], 0);
smallImage.data.set([0.5, 0.5, 0.5, 1], 16);

describe('writeJpegGainMap', () => {
  it('should produce valid JPEG-R file', () => {
    const encodingResult = encodeGainMap(smallImage);
    const jpegR = writeJpegGainMap(encodingResult);

    expect(jpegR).toBeInstanceOf(Uint8Array);
    expect(jpegR.length).toBeGreaterThan(100);
    expect(jpegR[0]).toBe(0xff);
    expect(jpegR[1]).toBe(0xd8);
  });

  it('should accept quality option', () => {
    const encodingResult = encodeGainMap(smallImage);
    const jpegRDefault = writeJpegGainMap(encodingResult);
    const jpegRHigh = writeJpegGainMap(encodingResult, { quality: 95 });
    const jpegRLow = writeJpegGainMap(encodingResult, { quality: 50 });

    expect(jpegRHigh.length).toBeGreaterThanOrEqual(jpegRLow.length);
    expect(jpegRDefault.length).toBeGreaterThan(0);
  });
});

describe('writeGainMapAsSeparateFiles', () => {
  it('should produce SDR JPEG, gain map JPEG, and metadata', () => {
    const encodingResult = encodeGainMap(smallImage);
    const result = writeGainMapAsSeparateFiles(encodingResult);

    expect(result.sdrImage).toBeInstanceOf(Uint8Array);
    expect(result.gainMapImage).toBeInstanceOf(Uint8Array);
    expect(result.metadata).toBeDefined();
    expect(result.sdrImage[0]).toBe(0xff);
    expect(result.sdrImage[1]).toBe(0xd8);
    expect(result.gainMapImage[0]).toBe(0xff);
    expect(result.gainMapImage[1]).toBe(0xd8);
    expect(result.metadata.gamma).toBeDefined();
    expect(result.metadata.gainMapMin).toBeDefined();
    expect(result.metadata.gainMapMax).toBeDefined();
  });

  it('should accept quality option', () => {
    const encodingResult = encodeGainMap(smallImage);
    const result = writeGainMapAsSeparateFiles(encodingResult, { quality: 80 });

    expect(result.sdrImage.length).toBeGreaterThan(0);
    expect(result.gainMapImage.length).toBeGreaterThan(0);
  });
});
