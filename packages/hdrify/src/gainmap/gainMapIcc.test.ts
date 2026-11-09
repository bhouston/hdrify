import { describe, expect, it } from 'vitest';
import { readIccProfile, writeIccProfile } from 'hdrify-icc';
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
function opaqueProfile(space = 'RGB ', large = false): Uint8Array {
  const profile = readIccProfile(DEFAULT_ICC_PROFILE.subarray(14));
  profile.header.set(new TextEncoder().encode(space), 16);
  profile.tags.push({ signature: 'A2B0', data: new Uint8Array([109, 65, 66, 32, 0, 0, 0, 0, 42]) });
  const opaque = new Uint8Array(large ? 150_003 : 7).fill(173);
  opaque.set([0xff, 0xd9, 0xff, 0xd8], 2); // These are profile bytes, not JPEG boundaries.
  profile.tags.push({ signature: 'priv', data: opaque });
  const bytes = writeIccProfile(profile);
  bytes.fill(91, 84, 100); // Preserve an existing profile ID; embedding must not reserialize.
  return bytes;
}

describe.each(['ultrahdr', 'adobe-gainmap'] as const)('%s ICC metadata', (format) => {
  it.each(['RGB ', 'CMYK', 'GRAY'])('retains arbitrary %s profiles without applying a transform', (space) => {
    const profile = opaqueProfile(space);
    const input = encoding();
    const baseline = readJpegGainMap(writeJpegGainMap(input, { format, icc: null }));
    const jpeg = writeJpegGainMap(input, { format, iccProfile: profile });
    const decoded = readJpegGainMap(jpeg);
    expect(extractIccProfileFromJpeg(jpeg)).toEqual(profile);
    expect(decoded.metadata?.iccProfile).toEqual(profile);
    expect(decoded.metadata?.iccColorManaged).toBe(false);
    expect(decoded.data).toEqual(baseline.data);
    jpeg.fill(0);
    expect(decoded.metadata?.iccProfile).toEqual(profile);
  });

  it('round-trips multipart ICC profiles including opaque tags', () => {
    const profile = opaqueProfile('RGB ', true);
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
    const profile = opaqueProfile('CMYK', true);
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
