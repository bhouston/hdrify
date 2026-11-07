import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pqToNits, nitsToPq } from '../color/transfer.js';
import { applyMatrix3ToFloat32Array, getLinearToLinearMatrix } from '../color/matrixConversion.js';
import { ASSETS, readPfm } from './jxlTestAssets.js';
import { readJxl } from './readJxl.js';
describe('PQ transfer function', () => {
  it('ST2084 returns nits at published landmarks and roundtrips extended signed values', () => {
    expect(pqToNits(0)).toBe(0);
    expect(pqToNits(1)).toBeCloseTo(10000, 6);
    expect(pqToNits(0.508078421517399)).toBeCloseTo(100, 6);
    for (const v of [-1, -0.2, 0.2, 0.5, 1]) expect(nitsToPq(pqToNits(v))).toBeCloseTo(v, 10);
  });
});
describe('JPEG XL colour corpus against djxl linear Rec.2020 float output', () => {
  for (const name of ['pq'])
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
