import { readFileSync } from 'node:fs';
import { readExr, readJxl } from 'hdrify';
import { describe, expect, it } from 'vitest';

const assets = new URL('../../../../assets/', import.meta.url);

describe('full-size libjxl reference images', () => {
  it.each(['memorial', 'reference_gradient', 'reference_cie'])(
    '%s lossless JXL retains the EXR samples and color space',
    (name) => {
      const source = readExr(readFileSync(new URL(`${name}.exr`, assets)));
      const image = readJxl(readFileSync(new URL(`${name}.jxl`, assets)));
      expect([image.width, image.height, image.linearColorSpace]).toEqual([
        source.width,
        source.height,
        source.linearColorSpace,
      ]);
      expect(image.metadata?.container).toBe(true);
      expect(image.metadata?.floatSample).toBe(true);
      expect(image.data.length).toBe(source.data.length);
      // One aggregate assertion avoids millions of test assertions on full-size images.
      let maxError = 0;
      let maxRgb = 0;
      for (let i = 0; i < image.data.length; i++) {
        maxError = Math.max(maxError, Math.abs(image.data[i]! - source.data[i]!));
        if (i % 4 !== 3) maxRgb = Math.max(maxRgb, image.data[i]!);
      }
      expect(maxError).toBe(0);
      if (name !== 'reference_gradient') expect(maxRgb).toBeGreaterThan(100);
    },
  );

  it('decodes the official lossy codestream without clipping HDR values', () => {
    const image = readJxl(readFileSync(new URL('memorial_lossy.jxl', assets)));
    expect([image.width, image.height]).toEqual([512, 768]);
    expect(image.metadata?.container).toBe(false);
    expect(image.metadata?.encoding).toBe('vardct');
    expect(image.linearColorSpace).toBe('linear-rec709');
    let maxRgb = 0;
    for (let i = 0; i < image.data.length; i++) {
      if (i % 4 !== 3) maxRgb = Math.max(maxRgb, image.data[i]!);
    }
    expect(maxRgb).toBeGreaterThan(250);
    expect(image.data.every(Number.isFinite)).toBe(true);
  });
});
