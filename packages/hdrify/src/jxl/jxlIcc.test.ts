import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMatrix3ToFloat32Array, getLinearToLinearMatrix } from '../color/matrixConversion.js';
import { ASSETS, readPfm } from './jxlTestAssets.js';
import { readJxl } from './readJxl.js';
describe('JPEG XL colour corpus against djxl linear Rec.2020 float output', () => {
  for (const name of ['display_p3', 'adobe_rgb', 'prophoto', 'pq_icc', 'gray_icc'])
    for (const d of [0, 1]) {
      it(`${name} distance ${d}`, () => {
        const path = `color/${name}-d${d}`;
        const img = readJxl(fs.readFileSync(new URL(`${path}.jxl`, ASSETS)), { unsupportedIcc: 'throw' });
        const ref = readPfm(`${path}.ref.pfm`);
        const m = getLinearToLinearMatrix(img.linearColorSpace, 'linear-rec2020');
        if (m) applyMatrix3ToFloat32Array(img.data, m);
        let err = 0;
        // Gray references hold one linear sample per pixel; R = G = B in linear Rec.2020.
        for (let i = 0; i < ref.width * ref.height * 3; i++) {
          const expected = ref.samples[ref.channels === 3 ? i : Math.floor(i / 3)];
          err = Math.max(err, Math.abs(expected - img.data[Math.floor(i / 3) * 4 + (i % 3)]));
        }
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

it('rejects singular embedded ICC matrices instead of returning nonfinite colour pixels', async () => {
  const { readIccProfile, writeIccProfile } = await import('hdrify-icc');
  const { JxlBitReader } = await import('./jxlBitReader.js');
  const { readImageHeader } = await import('./jxlImageHeader.js');
  const { extractCodestream } = await import('./jxlContainer.js');
  const { convertOutputColor } = await import('./jxlColor.js');
  const h = readImageHeader(
    new JxlBitReader(extractCodestream(fs.readFileSync(new URL('color/adobe_rgb-d0.jxl', ASSETS))).codestream),
  );
  const profile = readIccProfile(h.icc!);
  for (const t of profile.tags) if (['rXYZ', 'gXYZ', 'bXYZ'].includes(t.signature)) t.data.fill(0, 8, 20);
  h.icc = writeIccProfile(profile);
  expect(() => convertOutputColor(h, new Float32Array([0.2, 0.4, 0.6, 1]), false)).toThrow(
    'invalid colour encoding matrix',
  );
});

it('preserves native linear float samples including nonfinite neighbours and signed zero', async () => {
  const { writeJxl } = await import('./writeJxl.js');
  const data = new Float32Array([
    Infinity,
    0.5,
    0.25,
    1,
    -Infinity,
    0.125,
    0.75,
    1,
    NaN,
    0.625,
    0.875,
    1,
    -0,
    0.25,
    0.5,
    1,
  ]);
  const encoded = writeJxl(
    { width: 4, height: 1, data, linearColorSpace: 'linear-rec709' },
    { bitDepth: 'float32', sanitize: false },
  );
  const decoded = readJxl(encoded);
  expect([...decoded.data]).toEqual([...data]);
  expect(new Uint32Array(decoded.data.buffer)[12]).toBe(0x80000000);
});

it('retains an embedded ICC profile without reporting placeholder enum chromaticities', () => {
  const image = readJxl(fs.readFileSync(new URL('color/adobe_rgb-d0.jxl', ASSETS)));
  expect(image.metadata?.iccProfile).toBeInstanceOf(Uint8Array);
  expect(image.metadata?.iccColorManaged).toBe(true);
  expect(image.metadata).not.toHaveProperty('originalChromaticities');
});

it('retains original chromaticities for enum and custom colour declarations', () => {
  const native = readJxl(fs.readFileSync(new URL('color/pq-d0.jxl', ASSETS)));
  expect(native.metadata?.originalChromaticities).toMatchObject({
    greenX: 0.17,
    greenY: 0.797,
    whiteX: 0.3127,
    whiteY: 0.329,
  });
  const custom = readJxl(fs.readFileSync(new URL('color/custom-d0.jxl', ASSETS)));
  expect(custom.metadata?.originalChromaticities).toMatchObject({ redX: 0.64, greenX: 0.21, blueX: 0.15 });
  expect(custom.metadata?.originalChromaticities).toMatchObject({
    whiteX: expect.closeTo(0.345669, 5),
    whiteY: expect.closeTo(0.358496, 5),
  });
});

/** Header of an asset with its embedded ICC profile edited. */
const withProfile = async (name: string, edit: (p: import('hdrify-icc').IccProfile) => void) => {
  const { readIccProfile, writeIccProfile } = await import('hdrify-icc');
  const { JxlBitReader } = await import('./jxlBitReader.js');
  const { readImageHeader } = await import('./jxlImageHeader.js');
  const { extractCodestream } = await import('./jxlContainer.js');
  const h = readImageHeader(
    new JxlBitReader(extractCodestream(fs.readFileSync(new URL(`color/${name}.jxl`, ASSETS))).codestream),
  );
  const p = readIccProfile(h.icc!);
  edit(p);
  h.icc = writeIccProfile(p);
  return h;
};

describe("unsupportedIcc: 'fallback' (default) vs 'throw'", () => {
  it('LUT RGB profile: sRGB fallback by default, descriptive error with throw', async () => {
    const { readIccProfile, writeIccProfile } = await import('hdrify-icc');
    const { writeJxlEncoded } = await import('./writeJxl.js');
    const p = readIccProfile(new Uint8Array(fs.readFileSync(new URL('color/adobe_rgb.icc', ASSETS))));
    p.tags.push({ signature: 'A2B0', data: new Uint8Array(12) });
    const data = Float32Array.from({ length: 16 }, (_, i) => (i % 4 === 3 ? 1 : 0.5));
    const file = writeJxlEncoded({ width: 2, height: 2, data, iccProfile: writeIccProfile(p) });
    const fallback = readJxl(file, { unsupportedIcc: 'fallback' });
    expect(fallback.metadata?.iccColorManaged).toBe(false);
    expect(fallback.linearColorSpace).toBe('linear-rec709');
    expect(readJxl(file).data).toEqual(fallback.data);
    const { readJxlFrames } = await import('./readJxl.js');
    for (const read of [readJxl, readJxlFrames])
      expect(() => read(file, { unsupportedIcc: 'throw' })).toThrow(
        "JXL: embedded ICC profile cannot be colour-managed ('mntr' class, 'RGB' colour space, 'XYZ' PCS, LUT-based)",
      );
  });

  it('CMYK profile: sRGB fallback by default, descriptive error with throw', async () => {
    const { assertJxlIccSupported, convertOutputColor, jxlColorMetadata } = await import('./jxlColor.js');
    const h = await withProfile('adobe_rgb-d0', (p) => {
      p.header.set(new TextEncoder().encode('prtrCMYKLab '), 12);
      p.tags.push({ signature: 'A2B0', data: new Uint8Array(12) });
    });
    const rgba = new Float32Array([0.5, 0.5, 0.5, 1]);
    expect(convertOutputColor(h, rgba, false)).toBe('linear-rec709');
    expect(rgba[0]).toBeCloseTo(0.21404114, 7);
    expect(jxlColorMetadata(h).iccColorManaged).toBe(false);
    expect(() => assertJxlIccSupported(h)).toThrow("('prtr' class, 'CMYK' colour space, 'Lab' PCS, LUT-based)");
  });

  it('gray kTRC profile is colour-managed in both modes; LUT gray falls back or throws', async () => {
    const file = fs.readFileSync(new URL('color/gray_icc-d0.jxl', ASSETS));
    const managed = readJxl(file);
    expect(managed.metadata?.iccColorManaged).toBe(true);
    expect(readJxl(file, { unsupportedIcc: 'throw' }).data).toEqual(managed.data);
    // kTRC gamma 1.8 applied to the first sample 1/33, with R = G = B.
    expect(managed.data[0]).toBeCloseTo((1 / 33) ** 1.8, 4);
    expect(managed.data[1]).toBeCloseTo(managed.data[0], 4);
    const { assertJxlIccSupported, jxlColorMetadata } = await import('./jxlColor.js');
    const lut = await withProfile('gray_icc-d0', (p) => p.tags.push({ signature: 'A2B0', data: new Uint8Array(12) }));
    expect(jxlColorMetadata(lut).iccColorManaged).toBe(false);
    expect(() => assertJxlIccSupported(lut)).toThrow("'GRAY' colour space, 'XYZ' PCS, LUT-based");
  });
});
