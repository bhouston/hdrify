import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSrgbIccProfile, readIccProfile, writeIccProfile } from 'hdrify-icc';
import { convertFloat32ToLinearColorSpace } from '../color/convert.js';
import { decodeFloat16 } from '../exr/halfFloat.js';
import { encodeGainMap } from './gainMapEncoder.js';
import { DEFAULT_ICC_PROFILE } from './libultrahdr/defaultIccProfile.js';
import { extractIccProfileFromJpeg } from './libultrahdr/iccFromJpeg.js';
import { encodeJPEGMetadata } from './libultrahdr/encode-jpeg-metadata.js';
import { readJpegGainMap } from './readJpegGainMap.js';
import { writeGainMapAsSeparateFiles, writeJpegGainMap } from './writeJpegGainMap.js';

const encoding = () =>
  encodeGainMap({
    width: 2,
    height: 2,
    linearColorSpace: 'linear-rec709',
    data: new Float32Array([0.2, 0.4, 1, 1, 1, 0.5, 0.1, 1, 2, 1, 0.3, 1, 0.1, 0.1, 0.1, 1]),
  });
const asset = (name: string) => new Uint8Array(readFileSync(new URL(`../../../../assets/${name}`, import.meta.url)));
function opaqueProfile(space = 'RGB ', large = false, lut = true): Uint8Array {
  const profile = readIccProfile(DEFAULT_ICC_PROFILE.subarray(14));
  profile.header.set(new TextEncoder().encode(space), 16);
  if (lut) profile.tags.push({ signature: 'A2B0', data: new Uint8Array([109, 65, 66, 32, 0, 0, 0, 0, 42]) });
  const opaque = new Uint8Array(large ? 150_003 : 7).fill(173);
  opaque.set([0xff, 0xd9, 0xff, 0xd8], 2); // These are profile bytes, not JPEG boundaries.
  profile.tags.push({ signature: 'priv', data: opaque });
  const bytes = writeIccProfile(profile);
  bytes.fill(91, 84, 100); // Preserve an existing profile ID; embedding must not reserialize.
  return bytes;
}

describe.each(['ultrahdr', 'adobe-gainmap'] as const)('%s ICC metadata', (format) => {
  it.each(['RGB ', 'CMYK', 'GRAY'])('rejects %s LUT profiles that do not describe the sRGB base', (space) => {
    expect(() => writeJpegGainMap(encoding(), { format, iccProfile: opaqueProfile(space) })).toThrow(
      'Gain map JPEG: embedded ICC profile cannot be colour-managed',
    );
  });

  it('rejects evaluable non-sRGB profiles instead of mislabelling the sRGB base', () => {
    for (const iccProfile of [asset('jxl/color/display_p3.icc'), asset('jxl/color/gray_icc.icc')])
      expect(() => writeJpegGainMap(encoding(), { format, iccProfile })).toThrow('does not describe sRGB');
  });

  it('round-trips caller sRGB profiles consistently with the default', () => {
    const input = encoding();
    const baseline = readJpegGainMap(writeJpegGainMap(input, { format, icc: null }));
    const profile = createSrgbIccProfile();
    const decoded = readJpegGainMap(writeJpegGainMap(input, { format, iccProfile: profile }));
    expect(decoded.metadata?.iccProfile).toEqual(profile);
    expect(decoded.metadata?.iccColorManaged).toBeUndefined();
    expect(decoded.linearColorSpace).toBe('linear-rec709');
    decoded.data.forEach((v, i) => expect(v).toBeCloseTo(baseline.data[i], 4));
  });

  it.each([
    [16, 'CMYK', /cannot be colour-managed \('mntr' class, 'CMYK' colour space, 'XYZ' PCS\)/],
    [-1, 'A2B0', /cannot be colour-managed \('mntr' class, 'RGB' colour space, 'XYZ' PCS, LUT-based\)/],
  ] as const)('reads embedded %s/%s profiles with the JPEG XL policy error', (offset, bytes, error) => {
    const jpeg = writeJpegGainMap(encoding(), { format });
    // Patch the profile in place (same length): header colour space, or the rTRC tag signature.
    const find = (text: string) => {
      const b = new TextEncoder().encode(text);
      return jpeg.findIndex((_, i) => b.every((c, j) => jpeg[i + j] === c));
    };
    const at = offset < 0 ? find('rTRC') : find('ICC_PROFILE\0') + 14 + offset;
    jpeg.set(new TextEncoder().encode(bytes), at);
    expect(() => readJpegGainMap(jpeg)).toThrow(error);
  });

  it('round-trips multipart ICC profiles including opaque tags', () => {
    const profile = opaqueProfile('RGB ', true, false);
    const jpeg = writeJpegGainMap(encoding(), { format, iccProfile: profile });
    const decoded = readJpegGainMap(jpeg);
    expect(extractIccProfileFromJpeg(jpeg)).toEqual(profile);
    expect(decoded.metadata?.iccProfile).toEqual(profile);
    const retained = decoded.metadata?.iccProfile;
    if (!(retained instanceof Uint8Array)) throw new Error('Missing ICC profile');
    expect(readIccProfile(retained).tags.at(-1)?.data.length).toBe(150_003);
  });

  it('supports default, omission, and the legacy APP2 payload consistently', () => {
    const input = encoding();
    expect(extractIccProfileFromJpeg(writeJpegGainMap(input, { format }))).toEqual(DEFAULT_ICC_PROFILE.subarray(14));
    expect(extractIccProfileFromJpeg(writeJpegGainMap(input, { format, iccProfile: null }))).toBeNull();
    expect(extractIccProfileFromJpeg(writeJpegGainMap(input, { format, icc: null }))).toBeNull();
    expect(extractIccProfileFromJpeg(writeJpegGainMap(input, { format, icc: DEFAULT_ICC_PROFILE }))).toEqual(
      DEFAULT_ICC_PROFILE.subarray(14),
    );
  });

  it('rejects malformed profiles and ambiguous options', () => {
    const input = encoding();
    expect(() => writeJpegGainMap(input, { format, iccProfile: new Uint8Array(132) })).toThrow('ICC');
    expect(() => writeJpegGainMap(input, { format, icc: new Uint8Array(14) })).toThrow('APP2');
    const incomplete = new Uint8Array(DEFAULT_ICC_PROFILE);
    incomplete[13] = 2;
    expect(() => writeJpegGainMap(input, { format, icc: incomplete })).toThrow('APP2');
    expect(() => writeJpegGainMap(input, { format, icc: null, iccProfile: null })).toThrow('either');
    const jpeg = writeJpegGainMap(input, { format });
    // Corrupt ICC's acsp signature without changing JPEG framing.
    const prefix = new TextEncoder().encode('ICC_PROFILE\0');
    const off = jpeg.findIndex((_, i) => prefix.every((b, j) => jpeg[i + j] === b));
    jpeg[off + 14 + 36] = 0;
    expect(() => readJpegGainMap(jpeg)).toThrow('ICC');
  });
});

describe('separate-file ICC metadata', () => {
  it('embeds complete caller profiles only in the SDR JPEG', () => {
    const profile = opaqueProfile('RGB ', true, false);
    const files = writeGainMapAsSeparateFiles(encoding(), { iccProfile: profile });
    expect(extractIccProfileFromJpeg(files.sdrImage)).toEqual(profile);
    expect(extractIccProfileFromJpeg(files.gainMapImage)).toBeNull();
  });
  it('uses the same default, legacy, omission, and validation policy', () => {
    const input = encoding();
    expect(extractIccProfileFromJpeg(writeGainMapAsSeparateFiles(input).sdrImage)).toEqual(
      DEFAULT_ICC_PROFILE.subarray(14),
    );
    expect(
      extractIccProfileFromJpeg(writeGainMapAsSeparateFiles(input, { icc: DEFAULT_ICC_PROFILE }).sdrImage),
    ).toEqual(DEFAULT_ICC_PROFILE.subarray(14));
    expect(extractIccProfileFromJpeg(writeGainMapAsSeparateFiles(input, { iccProfile: null }).sdrImage)).toBeNull();
    expect(() => writeGainMapAsSeparateFiles(input, { iccProfile: new Uint8Array() })).toThrow('ICC');
    expect(() => writeGainMapAsSeparateFiles(input, { iccProfile: opaqueProfile('CMYK') })).toThrow('colour-managed');
  });
});

describe('pretagged compressed input', () => {
  it('rejects duplicate or implicit ICC policies in the internal assembler entry point', () => {
    const input = encoding();
    const files = writeGainMapAsSeparateFiles(input);
    const compressed = (data: Uint8Array) => ({
      data,
      width: input.width,
      height: input.height,
      mimeType: 'image/jpeg' as const,
    });
    for (const format of ['ultrahdr', 'adobe-gainmap'] as const) {
      expect(() =>
        encodeJPEGMetadata(
          {
            ...input.metadata,
            sdr: compressed(files.sdrImage),
            gainMap: compressed(files.gainMapImage),
          },
          { format, icc: null },
        ),
      ).toThrow('already contains ICC');
    }
  });
});

describe('Display P3 Ultra HDR (libultrahdr fixture, scripts/generate-gainmap-icc-assets.sh)', () => {
  it('decodes in linear Display P3 within tolerance of libultrahdr', () => {
    const decoded = readJpegGainMap(asset('gainmap/p3.jpg'));
    expect(decoded.linearColorSpace).toBe('linear-p3');
    const raw = asset('gainmap/p3.ref.raw'),
      view = new DataView(raw.buffer, raw.byteOffset);
    const reference = Float32Array.from({ length: raw.length / 2 }, (_, i) =>
      decodeFloat16(view.getUint16(i * 2, true)),
    );
    // Compare in one space so a mislabelled (sRGB-assumed) decode fails; JPEG decoders differ in chroma upsampling.
    const error = (data: Float32Array, space: 'linear-p3' | 'linear-rec709') => {
      const a = convertFloat32ToLinearColorSpace(data, 32, 16, space, 'linear-rec2020'),
        b = convertFloat32ToLinearColorSpace(reference, 32, 16, 'linear-p3', 'linear-rec2020');
      let sum = 0,
        max = 0;
      for (let i = 0; i < a.length; i++) {
        if (i % 4 === 3) continue;
        const e = Math.abs(a[i] - b[i]) / (b[i] + 0.05);
        sum += e;
        max = Math.max(max, e);
      }
      return { mean: sum / (a.length * 0.75), max };
    };
    const ok = error(decoded.data, 'linear-p3');
    expect(ok.mean).toBeLessThan(0.02);
    expect(ok.max).toBeLessThan(0.06);
    expect(error(decoded.data, 'linear-rec709').mean).toBeGreaterThan(0.05);
  });
});
