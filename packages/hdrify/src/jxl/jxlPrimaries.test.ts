import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMatrix3ToFloat32Array, bradfordAdaptation, getLinearToLinearMatrix } from '../color/matrixConversion.js';
import { ASSETS, readPfm } from './jxlTestAssets.js';
import { readJxl } from './readJxl.js';
describe('chromatic adaptation', () => {
  it('Bradford D50 to D65 matches the published matrix', () => {
    const m = bradfordAdaptation([0.34567, 0.3585], [0.3127, 0.329]);
    const published = [
      [0.9556, -0.023, 0.0632],
      [-0.0283, 1.0099, 0.021],
      [0.0123, -0.0205, 1.3299],
    ];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) expect(m[r][c]).toBeCloseTo(published[r][c], 3);
  });
});
describe('JPEG XL colour corpus against djxl linear Rec.2020 float output', () => {
  for (const name of ['p3_dci', 'equal_energy', 'custom'])
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
