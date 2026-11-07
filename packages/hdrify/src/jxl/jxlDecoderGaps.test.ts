import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readJxl } from '../index.js';
import { ASSETS, readPfm } from './jxlTestAssets.js';
import { JxlBitReader } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import { writeBitDepth, writeSizeHeader } from './jxlEncHeaders.js';
import { readImageHeader } from './jxlImageHeader.js';
import { writeJxl } from './writeJxl.js';
import { extractCodestream } from './jxlContainer.js';

const bytes = (name: string) => new Uint8Array(fs.readFileSync(new URL(`features/${name}.jxl`, ASSETS)));

// A complete, independent 1x1 preview before a 3x2 main image. cjxl does not emit previews.
function previewFile(): Uint8Array {
  const { codestream: main } = extractCodestream(bytes('orientation1'));
  const br = new JxlBitReader(main);
  readImageHeader(br);
  const preview = writeJxl(
    { width: 1, height: 1, data: new Float32Array([1, 0, 0, 1]), linearColorSpace: 'linear-rec709' },
    { bitDepth: 'float32' },
  );
  const pbr = new JxlBitReader(preview);
  readImageHeader(pbr);
  const w = new JxlBitWriter();
  w.writeBits(16, 0x0aff);
  writeSizeHeader(w, 3, 2);
  w.writeBool(false); // metadata all_default
  w.writeBool(true); // extra_fields
  w.writeBits(3, 0); // orientation
  w.writeBool(false); // intrinsic size
  w.writeBool(true); // preview
  w.writeBool(false); // preview dimensions not divisible by 8
  w.writeBits(2, 0);
  w.writeBits(6, 0); // preview height = 1
  w.writeBits(3, 1); // square aspect ratio
  w.writeBool(false); // animation
  writeBitDepth(w, { float: true, bitsPerSample: 32, expBits: 8 });
  w.writeBool(false); // modular 16-bit buffer
  w.writeU32(0, 0, 1, { bits: 4, offset: 2 }, { bits: 12, offset: 1 });
  w.writeBool(false); // non-XYB
  w.writeBool(false);
  w.writeBool(false); // colour all_default, want_icc
  w.writeEnum(0);
  w.writeEnum(1);
  w.writeEnum(1); // RGB, D65, sRGB primaries
  w.writeBool(false);
  w.writeEnum(8);
  w.writeEnum(1); // linear, relative intent
  w.writeBool(true); // tone mapping defaults
  w.writeU64(0); // extensions
  w.writeBool(true); // custom transform defaults
  w.zeroPadToByte();
  w.writeBytes(preview.subarray(pbr.byteOffset));
  w.writeBytes(main.subarray(br.byteOffset));
  return w.finish();
}

describe('JPEG XL decoder gaps', () => {
  it('writes the crafted preview fixture when requested', () => {
    const outDir = process.env.JXL_CRAFT_OUT;
    if (outDir) fs.writeFileSync(`${outDir}/preview.jxl`, previewFile());
  });
  it('skips a separately sized preview and returns the unchanged main image', () => {
    const file = previewFile();
    const expected = readJxl(bytes('orientation1'));
    expected.metadata!.container = false;
    expect(readJxl(file)).toEqual(expected);
    const ref = readPfm('features/preview.ref.pfm');
    for (let i = 0; i < 6; i++)
      for (let c = 0; c < 3; c++) expect(expected.data[i * 4 + c]).toBe(ref.samples[i * 3 + c]);
  });

  for (let orientation = 1; orientation <= 8; orientation++) {
    it(`applies orientation ${orientation} exactly like djxl, with an opt-out`, () => {
      const out = readJxl(bytes(`orientation${orientation}`));
      const ref = readPfm(`features/orientation${orientation}.ref.pfm`);
      expect([out.width, out.height]).toEqual([ref.width, ref.height]);
      for (let i = 0; i < out.width * out.height; i++) {
        expect(Array.from(out.data.subarray(i * 4, i * 4 + 3))).toEqual(
          Array.from(ref.samples.subarray(i * 3, i * 3 + 3)),
        );
      }
      const raw = readJxl(bytes(`orientation${orientation}`), { applyOrientation: false });
      expect([raw.width, raw.height]).toEqual([3, 2]);
      expect(raw.data).toEqual(readJxl(bytes('orientation1')).data);
      expect(raw.metadata?.orientation).toBe(orientation);
    });
  }

  it('unpremultiplies associated alpha, including tiny and zero alpha, with an opt-out', () => {
    const file = bytes('associated_alpha');
    const straight = readJxl(file);
    const associated = readJxl(file, { keepPremultipliedAlpha: true });
    expect(straight.metadata?.alphaPremultiplied).toBe(false);
    expect(associated.metadata?.alphaPremultiplied).toBe(true);
    const ref = readPfm('features/associated_alpha.ref.pfm');
    for (let i = 0; i < 6; i++)
      for (let c = 0; c < 3; c++) {
        expect(straight.data[i * 4 + c]).toBeCloseTo(ref.samples[i * 3 + c], 6);
        expect(straight.data[i * 4 + c]).toBeCloseTo(
          associated.data[i * 4 + c] / Math.max(associated.data[i * 4 + 3], 2 ** -26),
          6,
        );
      }
  });
});
