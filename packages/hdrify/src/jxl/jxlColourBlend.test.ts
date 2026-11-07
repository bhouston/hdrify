import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMatrix3ToFloat32Array, getLinearToLinearMatrix } from '../color/matrixConversion.js';
import { ASSETS, readPfm } from './jxlTestAssets.js';
import { readJxl } from './readJxl.js';
import { extractCodestream } from './jxlContainer.js';
import { JxlBitReader } from './jxlBitReader.js';
import { readImageHeader } from './jxlImageHeader.js';
import { xybFromLinear, convertOutputColor } from './jxlColor.js';
describe('XYB composition in the original encoded colour space', () => {
  for (const name of ['p3_layers', 'pq_layers', 'hlg_layers', 'custom_layers']) {
    it(`${name} matches djxl after encoded-space blending`, () => {
      const file = fs.readFileSync(new URL(`color/${name}.jxl`, ASSETS));
      const h = readImageHeader(new JxlBitReader(extractCodestream(file).codestream));
      const img = readJxl(file),
        ref = readPfm(`color/${name}.ref.pfm`);
      // djxl requires layered images to be rendered in their original encoding. Convert the public
      // linear output back to that encoding to compare directly to its coalesced PFM oracle.
      const m = getLinearToLinearMatrix(img.linearColorSpace, 'linear-rec709');
      if (m) applyMatrix3ToFloat32Array(img.data, m);
      const planes = [0, 1, 2].map((c) =>
        Float32Array.from({ length: img.width * img.height }, (_, i) => img.data[i * 4 + c]),
      );
      xybFromLinear(h, planes);
      let err = 0;
      for (let i = 0; i < ref.samples.length; i++)
        err = Math.max(err, Math.abs(ref.samples[i] - planes[i % 3][Math.floor(i / 3)]));
      expect(err).toBeLessThan(0.0002);
    });
  }
});

it('roundtrips extended negative RGB through the original P3 encoding', () => {
  const file = fs.readFileSync(new URL('color/p3_layers.jxl', ASSETS));
  const h = readImageHeader(new JxlBitReader(extractCodestream(file).codestream));
  const source = [-0.15, 0.25, 1.3];
  const planes = source.map((v) => new Float32Array([v]));
  xybFromLinear(h, planes);
  const rgba = new Float32Array([planes[0][0], planes[1][0], planes[2][0], 1]);
  const space = convertOutputColor(h, rgba, false);
  const m = getLinearToLinearMatrix(space, 'linear-rec709');
  if (m) applyMatrix3ToFloat32Array(rgba, m);
  for (let c = 0; c < 3; c++) expect(rgba[c]).toBeCloseTo(source[c], 5);
});
