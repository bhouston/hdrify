import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JxlBitWriter } from './jxlBitWriter.js';
import { JxlEncEntropyCode, packSigned } from './jxlEncEntropy.js';
import { writeImageMetadata, writeSizeHeader, writeToc } from './jxlEncHeaders.js';
import { ASSETS, readPfm } from './jxlTestAssets.js';
import { readJxl } from './readJxl.js';

/** Small YCbCr streams with asymmetric ramps and odd edges; cjxl does not expose Modular subsampling. */
function modularYCbCr(modes: number[]): Uint8Array {
  const width = 5;
  const height = 3;
  const hs = [0, 1, 1, 0];
  const vs = [0, 1, 0, 1];
  const maxH = Math.max(...modes.map((m) => hs[m]));
  const maxV = Math.max(...modes.map((m) => vs[m]));
  const values = modes.flatMap((m, c) => {
    const w = Math.ceil(width / 2 ** (maxH - hs[m]));
    const h = Math.ceil(height / 2 ** (maxV - vs[m]));
    return Array.from({ length: w * h }, (_, i) => packSigned((i % w) * 9 + Math.floor(i / w) * 7 - 20 + c * 8));
  });
  const tree = { contexts: [1, 2, 3, 4, 5], values: [0, 0, 0, 0, 0] }; // Zero predictor, single leaf.
  const data = { contexts: values.map(() => 0), values };
  const tc = JxlEncEntropyCode.build(6, [tree]);
  const dc = JxlEncEntropyCode.build(1, [data]);
  const section = new JxlBitWriter();
  section.writeBool(true); // LF dequant defaults
  section.writeBool(true); // global MA tree
  tc.writeHeader(section);
  tc.writeStream(section, tree);
  dc.writeHeader(section);
  section.writeBool(true); // use global tree
  section.writeBool(true); // WP defaults
  section.writeU32(0, 0, 1, { bits: 4, offset: 2 }, { bits: 8, offset: 18 });
  dc.writeStream(section, data);
  const payload = section.finish();
  const w = new JxlBitWriter();
  w.writeBits(8, 0xff);
  w.writeBits(8, 0x0a);
  writeSizeHeader(w, width, height);
  writeImageMetadata(
    w,
    { float: false, bitsPerSample: 8, expBits: 0 },
    { grey: false, orientation: 1, extraChannels: [] },
    'linear-rec709',
  );
  w.writeBool(false); // frame defaults
  w.writeBits(2, 0); // regular
  w.writeBits(1, 1); // Modular
  w.writeU64(0); // flags
  w.writeBool(true); // YCbCr
  for (const m of modes) w.writeBits(2, m);
  w.writeU32(1, 1, 2, 4, 8); // upsampling
  w.writeBits(2, 1); // group size
  w.writeU32(1, 1, 2, 3, { bits: 3, offset: 4 }); // passes
  w.writeBool(false); // custom size
  w.writeU32(0, 0, 1, 2, { bits: 2, offset: 3 }); // replace
  w.writeBool(true); // last
  w.writeU32(0, 0, { bits: 4, offset: 0 }, { bits: 5, offset: 16 }, { bits: 10, offset: 48 }); // name
  w.writeBool(false); // filter defaults
  w.writeBool(false); // gaborish
  w.writeBits(2, 0); // EPF
  w.writeU64(0);
  w.writeU64(0);
  writeToc(w, [payload.length]);
  w.writeBytes(payload);
  return w.finish();
}

const cases = [
  ['444', [0, 0, 0]],
  ['420', [0, 1, 0]],
  ['422', [0, 2, 0]],
  ['440', [0, 3, 0]],
] as const;
describe('Modular YCbCr with chroma subsampling', () => {
  for (const [name, modes] of cases) {
    it(`${name} matches djxl at odd image edges`, () => {
      const bytes = modularYCbCr([...modes]);
      const file = `modular-colour/modular_ycbcr${name}`;
      if (process.env.GENERATE_MODULAR_COLOUR) {
        fs.writeFileSync(new URL(`${file}.jxl`, ASSETS), bytes);
        return;
      }
      expect(bytes).toEqual(new Uint8Array(fs.readFileSync(new URL(`${file}.jxl`, ASSETS))));
      const image = readJxl(bytes);
      const ref = readPfm(`${file}.ref.pfm`);
      expect([image.width, image.height]).toEqual([ref.width, ref.height]);
      for (let i = 0; i < image.width * image.height; i++) {
        for (let c = 0; c < 3; c++) expect(image.data[4 * i + c]).toBeCloseTo(ref.samples[3 * i + c], 6);
        expect(image.data[4 * i + 3]).toBe(1);
      }
    });
  }
});
