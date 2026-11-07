import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMatrix3ToFloat32Array, getLinearToLinearMatrix } from '../color/matrixConversion.js';
import { ASSETS, readPfm } from './jxlTestAssets.js';
import { readJxl } from './readJxl.js';
describe('JPEG XL colour corpus against djxl linear Rec.2020 float output', () => {
  for (const name of ['display_p3', 'adobe_rgb', 'prophoto', 'pq_icc'])
    for (const d of [0, 1]) {
      it(`${name} distance ${d}`, () => {
        const path = `color/${name}-d${d}`;
        const img = readJxl(fs.readFileSync(new URL(`${path}.jxl`, ASSETS)));
        const ref = readPfm(`${path}.ref.pfm`);
        const m = getLinearToLinearMatrix(img.linearColorSpace, 'linear-rec2020');
        if (m) applyMatrix3ToFloat32Array(img.data, m);
        let err = 0;
        for (let i = 0; i < ref.samples.length; i++)
          err = Math.max(err, Math.abs(ref.samples[i] - img.data[Math.floor(i / 3) * 4 + (i % 3)]));
        expect(err).toBeLessThan(0.00015);
        if (img.metadata?.iccProfile) expect(img.metadata.iccColorManaged).toBe(true);
        expect(img.metadata?.linearReferenceWhiteNits).toBe(img.metadata?.intensityTarget);
      });
    }
});

it('marks unsupported LUT profiles and applies the documented integer-sRGB fallback', async () => {
  const { readIccProfile, writeIccProfile } = await import('hdrify-icc');
  const { JxlBitReader } = await import('./jxlBitReader.js');
  const { readImageHeader } = await import('./jxlImageHeader.js');
  const { extractCodestream } = await import('./jxlContainer.js');
  const { convertOutputColor, jxlColorMetadata } = await import('./jxlColor.js');
  const file = fs.readFileSync(new URL('color/adobe_rgb-d0.jxl', ASSETS));
  const h = readImageHeader(new JxlBitReader(extractCodestream(file).codestream));
  const p = readIccProfile(h.icc!);
  p.tags.push({ signature: 'A2B0', data: new Uint8Array(12) });
  h.icc = writeIccProfile(p);
  const rgba = new Float32Array([0.5, 0.5, 0.5, 0.25]);
  expect(convertOutputColor(h, rgba, false)).toBe('linear-rec709');
  expect(rgba[0]).toBeCloseTo(0.21404114, 7);
  expect(rgba[3]).toBe(0.25);
  expect(jxlColorMetadata(h).iccColorManaged).toBe(false);
});
