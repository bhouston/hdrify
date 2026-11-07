import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JxlBitReader } from './jxlBitReader.js';
import { extractCodestream } from './jxlContainer.js';
import { readImageHeader } from './jxlImageHeader.js';
import { type ModularChannel } from './jxlModular.js';
import { ASSETS, readPfm, readPnm } from './jxlTestAssets.js';
import { decodeModularFrame } from './readJxl.js';

/** Modular frame decode of the first frame, via the production frame assembly. */
function decodeLosslessFile(name: string): { img: { channels: ModularChannel[] }; width: number; height: number } {
  const { codestream } = extractCodestream(new Uint8Array(fs.readFileSync(new URL(name, ASSETS))));
  const br = new JxlBitReader(codestream);
  const h = readImageHeader(br);
  const { channels, fh } = decodeModularFrame(codestream, br.byteOffset, h, { allowLossy: true });
  return { img: { channels }, width: fh.width, height: fh.height };
}

function expectMatchesPnm(jxl: string, ref: string): void {
  const { img, width, height } = decodeLosslessFile(jxl);
  const pnm = readPnm(ref);
  expect([width, height]).toEqual([pnm.width, pnm.height]);
  expect(img.channels.length).toBe(pnm.channels);
  let mismatches = 0;
  for (let c = 0; c < pnm.channels; c++) {
    const d = img.channels[c].data;
    for (let i = 0; i < width * height; i++) if (d[i] !== pnm.samples[i * pnm.channels + c]) mismatches++;
  }
  expect(mismatches).toBe(0);
}

describe('decodeModularStream on the lossless corpus', () => {
  for (const [jxl, ref] of [
    ['lossless_rgb8.jxl', 'lossless_rgb8.ref.ppm'],
    ['lossless_rgb8_e1.jxl', 'lossless_rgb8_e1.ref.ppm'],
    ['lossless_rgb8_e9.jxl', 'lossless_rgb8_e9.ref.ppm'],
    ['lossless_rgb8_container.jxl', 'lossless_rgb8_container.ref.ppm'],
    ['lossless_gray8.jxl', 'lossless_gray8.ref.pgm'],
    ['lossless_palette.jxl', 'lossless_palette.ref.ppm'],
    ['lossless_squeeze.jxl', 'lossless_squeeze.ref.ppm'],
    ['lossless_rgb16.jxl', 'lossless_rgb16.ref.ppm'],
    ['lossless_rgba8.jxl', 'lossless_rgba8.ref.pam'],
    ['lossless_multigroup.jxl', 'lossless_multigroup.ref.ppm'],
  ] as const) {
    it(`${jxl} matches ${ref}`, () => expectMatchesPnm(jxl, ref));
  }

  it('lossy_modular.jxl (XYB + squeeze) decodes with a valid ANS final state', () => {
    const { img, width, height } = decodeLosslessFile('lossy_modular.jxl');
    expect(img.channels.map((c) => [c.width, c.height])).toEqual([
      [width, height],
      [width, height],
      [width, height],
    ]);
  });
});

function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? Number.NaN : s * Number.POSITIVE_INFINITY;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

describe('decodeModularStream on lossless float files', () => {
  const f32 = new Float32Array(1);
  const i32 = new Int32Array(f32.buffer);
  for (const [jxl, ref, bits] of [
    ['lossless_float32.jxl', 'lossless_float32.ref.pfm', 32],
    ['lossless_float16.jxl', 'lossless_float16.ref.pfm', 16],
  ] as const) {
    it(`${jxl} bit patterns match ${ref}`, () => {
      const { img, width, height } = decodeLosslessFile(jxl);
      const pfm = readPfm(ref);
      expect([width, height]).toEqual([pfm.width, pfm.height]);
      let mismatches = 0;
      for (let c = 0; c < pfm.channels; c++) {
        const d = img.channels[c].data;
        for (let i = 0; i < width * height; i++) {
          let v: number;
          if (bits === 32) {
            i32[0] = d[i]!;
            v = f32[0]!;
          } else {
            v = Math.fround(halfToFloat(d[i]));
          }
          if (!Object.is(v, pfm.samples[i * pfm.channels + c])) mismatches++;
        }
      }
      expect(mismatches).toBe(0);
    });
  }
});
