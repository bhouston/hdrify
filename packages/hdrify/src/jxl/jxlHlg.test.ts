import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hlgToScene, sceneToHlg, applyHlgOotf } from '../color/transfer.js';
import { applyMatrix3ToFloat32Array, getLinearToLinearMatrix } from '../color/matrixConversion.js';
import { ASSETS, readPfm } from './jxlTestAssets.js';
import { readJxl } from './readJxl.js';
describe('HLG transfer function', () => {
  it('HLG inverse OETF is continuous at the knee and sign preserving', () => {
    expect(hlgToScene(0)).toBe(0);
    expect(hlgToScene(0.5)).toBeCloseTo(1 / 12, 9);
    expect(hlgToScene(0.5 + 1e-8)).toBeCloseTo(1 / 12, 7);
    expect(hlgToScene(1)).toBeCloseTo(1, 6);
    for (const v of [-1, -0.5, 0, 0.25, 0.5, 1]) expect(sceneToHlg(hlgToScene(v))).toBeCloseTo(v, 7);
  });
});
describe('JPEG XL colour corpus against djxl linear Rec.2020 float output', () => {
  for (const name of ['hlg'])
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
        expect(img.metadata?.linearReferenceWhiteNits).toBe(img.metadata?.intensityTarget);
      });
    }
});

it('applies the RGB HLG OOTF and skips the near-unity system gamma', () => {
  const pixels = new Float32Array([0.2, 0.2, 0.2, 1, 0, 0, 0, 1]);
  applyHlgOotf(pixels, 1000, [0.2627, 0.678, 0.0593]);
  expect(pixels[0]).toBeCloseTo(0.2 ** 1.2, 7);
  const unchanged = pixels.slice();
  applyHlgOotf(pixels, 300, [0.2627, 0.678, 0.0593]);
  expect(pixels).toEqual(unchanged);
});
