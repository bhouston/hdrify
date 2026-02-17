import { describe, expect, it } from 'vitest';
import {
  compareFloatImages,
  createGradientImage,
  encodeGainMap,
  encodeToJpeg,
  readJpegGainMap,
  writeJpegGainMap,
} from '../index.js';

describe('readJpegGainMap', () => {
  it('round-trips: synthetic image → encodeGainMap → writeJpegGainMap → readJpegGainMap → compare within tolerance', () => {
    const original = createGradientImage({
      width: 8,
      height: 8,
      mode: 'horizontal',
      min: 0.2,
      max: 2,
    });
    const encoding = encodeGainMap(original, { toneMapping: 'reinhard' });
    const jpegBuffer = writeJpegGainMap(encoding, { quality: 100 });
    const decoded = readJpegGainMap(jpegBuffer);

    expect(decoded.width).toBe(original.width);
    expect(decoded.height).toBe(original.height);
    expect(decoded.metadata?.format).toBeDefined();

    const result = compareFloatImages(original, decoded, {
      tolerancePercent: 0.005,
      toleranceAbsolute: 0.005,
    });
    expect(result.match, `Round-trip: maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`).toBe(
      true,
    );
  });

  it('throws when given a plain JPEG without gain map metadata', () => {
    const plainJpeg = encodeToJpeg(new Uint8ClampedArray([64, 64, 64, 255]), 1, 1);
    expect(() => readJpegGainMap(plainJpeg.data)).toThrow(/Not a valid JPEG with gain map/);
  });
});
