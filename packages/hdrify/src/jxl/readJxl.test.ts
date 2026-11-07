import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sRGBToLinear } from '../color/srgb.js';
import { ASSETS, readPfm, readPnm } from './jxlTestAssets.js';
import { readJxl } from './readJxl.js';

const load = (name: string) => readJxl(new Uint8Array(fs.readFileSync(new URL(name, ASSETS))));

/** Max |decoded − expected| over RGBA, with `expected(i, c)` giving the reference value. */
function maxError(img: ReturnType<typeof readJxl>, expected: (i: number, c: number) => number): number {
  let max = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    for (let c = 0; c < 4; c++) max = Math.max(max, Math.abs(img.data[i * 4 + c] - expected(i, c)));
  }
  return max;
}

describe('readJxl lossless integer images (sRGB transfer → linear)', () => {
  for (const [jxl, ref] of [
    ['lossless_rgb8.jxl', 'lossless_rgb8.ref.ppm'],
    ['lossless_rgb8_e1.jxl', 'lossless_rgb8_e1.ref.ppm'],
    ['lossless_rgb8_e9.jxl', 'lossless_rgb8_e9.ref.ppm'],
    ['lossless_rgb8_container.jxl', 'lossless_rgb8_container.ref.ppm'],
    ['lossless_rgb16.jxl', 'lossless_rgb16.ref.ppm'],
    ['lossless_gray8.jxl', 'lossless_gray8.ref.pgm'],
    ['lossless_rgba8.jxl', 'lossless_rgba8.ref.pam'],
    ['lossless_palette.jxl', 'lossless_palette.ref.ppm'],
    ['lossless_squeeze.jxl', 'lossless_squeeze.ref.ppm'],
    ['lossless_multigroup.jxl', 'lossless_multigroup.ref.ppm'],
  ] as const) {
    it(`${jxl} matches ${ref}`, () => {
      const img = load(jxl);
      const pnm = readPnm(ref);
      expect([img.width, img.height]).toEqual([pnm.width, pnm.height]);
      expect(img.linearColorSpace).toBe('linear-rec709');
      const max = jxl.includes('16') ? 65535 : 255;
      const err = maxError(img, (i, c) => {
        if (c === 3) return pnm.channels === 4 ? pnm.samples[i * 4 + 3] / max : 1;
        const v = pnm.samples[i * pnm.channels + (pnm.channels === 1 ? 0 : c)] / max;
        return sRGBToLinear(v);
      });
      expect(err).toBeLessThan(1e-6);
    });
  }

  it('reports container and format metadata', () => {
    expect(load('lossless_rgb8_container.jxl').metadata).toMatchObject({
      format: 'JPEG XL',
      container: true,
      encoding: 'modular',
      bitsPerSample: 8,
    });
    expect(load('lossless_rgb8.jxl').metadata?.container).toBe(false);
  });
});

describe('readJxl lossless float images (linear)', () => {
  for (const [jxl, ref] of [
    ['lossless_float32.jxl', 'lossless_float32.ref.pfm'],
    ['lossless_float16.jxl', 'lossless_float16.ref.pfm'],
  ] as const) {
    it(`${jxl} equals ${ref} exactly, with HDR values > 1`, () => {
      const img = load(jxl);
      const pfm = readPfm(ref);
      expect([img.width, img.height]).toEqual([pfm.width, pfm.height]);
      expect(maxError(img, (i, c) => (c === 3 ? 1 : pfm.samples[i * 3 + c]))).toBe(0);
      expect(Math.max(...img.data)).toBeGreaterThan(1);
      expect(img.metadata?.floatSample).toBe(true);
    });
  }
});

describe('readJxl unsupported inputs fail clearly', () => {
  it('rejects non-JXL data', () => {
    expect(() => readJxl(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });

  for (const jxl of ['vardct_rgb8.jxl', 'vardct_float.jxl', 'lossy_modular.jxl']) {
    it(`${jxl} throws "not yet supported"`, () => {
      expect(() => load(jxl)).toThrow(/not yet supported/);
    });
  }

  it('decodes ICC-profile images and keeps the profile in metadata', () => {
    const img = load('icc_rec2020_pq.jxl');
    expect((img.metadata!.iccProfile as Uint8Array).length).toBe(456);
  });
});

describe('readJxl ∘ writeJxl round-trip', async () => {
  const { writeJxl } = await import('./writeJxl.js');
  const { createHsvRainbowImage } = await import('../synthetic/createHsvRainbowImage.js');

  for (const bitDepth of ['float32', 'float16', 'uint16'] as const) {
    for (const [w, h] of [
      [1, 1],
      [17, 5],
      [300, 260],
    ] as const) {
      it(`${bitDepth} ${w}x${h} with alpha${bitDepth === 'float32' ? ' is bit-exact' : ''}`, () => {
        const src = createHsvRainbowImage({ width: w, height: h, value: 1, intensity: 1 });
        for (let i = 0; i < w * h; i++) {
          src.data[i * 4] = src.data[i * 4] * 7.5; // HDR range
          src.data[i * 4 + 3] = (i % 5) / 4;
        }
        const out = readJxl(writeJxl(src, { bitDepth, container: w === 17 }));
        expect([out.width, out.height, out.linearColorSpace]).toEqual([w, h, src.linearColorSpace]);
        const tol = bitDepth === 'float32' ? 0 : bitDepth === 'float16' ? 7.5 * 2 ** -10 : 1 / 65535;
        let err = 0;
        for (let i = 0; i < src.data.length; i++) {
          const expected = bitDepth === 'uint16' ? Math.min(1, src.data[i]) : src.data[i];
          err = Math.max(err, Math.abs(out.data[i] - expected));
        }
        expect(err).toBeLessThanOrEqual(tol);
      });
    }
  }

  it('preserves P3 and Rec.2020 primaries', () => {
    const src = createHsvRainbowImage({ width: 8, height: 4, value: 1, intensity: 1 });
    for (const cs of ['linear-p3', 'linear-rec2020'] as const) {
      expect(readJxl(writeJxl({ ...src, linearColorSpace: cs })).linearColorSpace).toBe(cs);
    }
  });
});
