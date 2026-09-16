import { type HdrifyImage, writeExr } from 'hdrify';
import { FloatType } from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { describe, expect, it } from 'vitest';

// Unlike HdrifyImage/OpenEXR coordinates, EXRLoader returns bottom-up texture
// data for ALL codecs (including none). Normalize that convention explicitly.
// Binary fractions below are exact in HALF, avoiding quantization tolerances.
describe('EXR writer interoperability with three.js', () => {
  for (const height of [1, 8, 35, 64]) {
    for (const compression of ['none', 'rle', 'zip', 'zips', 'piz'] as const) {
      it(`${compression} preserves every pixel in an 8x${height} image`, () => {
        const width = 8;
        const data = new Float32Array(width * height * 4);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const r = (y * width + x + 1) / 1024;
            data.set([r, (x + 1) / 16, 1 - r, (y + 1) / 128], (y * width + x) * 4);
          }
        }
        const image: HdrifyImage = { width, height, data, linearColorSpace: 'linear-rec709' };
        const bytes = writeExr(image, { compression });
        const decoded = new EXRLoader().setDataType(FloatType).parse(bytes.slice().buffer);
        expect([decoded.width, decoded.height]).toEqual([width, height]);
        for (let y = 0; y < height; y++) {
          const start = (height - 1 - y) * width * 4;
          expect(Array.from(decoded.data.slice(start, start + width * 4)), `source row ${y}`).toEqual(
            Array.from(data.subarray(y * width * 4, (y + 1) * width * 4)),
          );
        }
      });
    }
  }
});
