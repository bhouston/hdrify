import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as referenceParse } from 'icc';
import { describe, expect, it } from 'vitest';
import { parse, readIccProfile, writeIccProfile } from './index.js';

// Construct inputs independently of hdrify-icc's writer and typed tag encoders.
function fixture(tags: { signature: string; data: Buffer }[]): Buffer {
  const size = 132 + tags.length * 12 + tags.reduce((sum, t) => sum + Math.ceil(t.data.length / 4) * 4, 0);
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32BE(size, 0);
  bytes.writeUInt32BE(0x04300000, 8);
  bytes.write('mntrRGB XYZ ', 12, 'ascii');
  bytes.write('acsp', 36, 'ascii');
  bytes.writeUInt32BE(tags.length, 128);
  let offset = 132 + tags.length * 12;
  tags.forEach((tag, i) => {
    bytes.write(tag.signature, 132 + i * 12, 'ascii');
    bytes.writeUInt32BE(offset, 136 + i * 12);
    bytes.writeUInt32BE(tag.data.length, 140 + i * 12);
    tag.data.copy(bytes, offset);
    offset += Math.ceil(tag.data.length / 4) * 4;
  });
  return bytes;
}

const text = Buffer.concat([Buffer.from('text\0\0\0\0'), Buffer.from('Copyright 2026\0\0')]);
const desc = Buffer.alloc(12 + 7 + 78);
desc.write('desc', 0, 'ascii');
desc.writeUInt32BE(7, 8);
desc.write('Legacy\0', 12, 'ascii');
const mluc = Buffer.alloc(28 + 10);
mluc.write('mluc', 0, 'ascii');
mluc.writeUInt32BE(1, 8);
mluc.writeUInt32BE(12, 12);
mluc.write('jaJP', 16, 'ascii');
mluc.writeUInt32BE(10, 20);
mluc.writeUInt32BE(28, 24);
// UTF-16BE, including an astral character encoded as a surrogate pair.
[0x8272, 0x5f69, 0xd83c, 0xdf08, 0x0021].forEach((unit, i) => mluc.writeUInt16BE(unit, 28 + i * 2));
const xyz = Buffer.alloc(20);
xyz.write('XYZ ', 0, 'ascii');
[-32768, 65536, 54061].forEach((value, i) => xyz.writeInt32BE(value, 8 + i * 4));

describe('icc 4.0.0 differential compatibility', () => {
  for (const name of [
    'sRGB_IEC61966-2-1_black_scaled.icc',
    'sRGB_ICC_v4_Appearance.icc',
    'Probev1_ICCv2.icc',
    'Probev1_ICCv4.icc',
    'USWebCoatedSWOP.icc',
    'D65_XYZ.icc',
    'ILFORD_CANpro-4000_GPGFG_ProPlatin.icc',
  ]) {
    it(`matches upstream icc fixture ${name} before and after writing`, () => {
      const bytes = readFileSync(new URL(`../../../assets/icc/reference/${name}`, import.meta.url));
      const expected = referenceParse(bytes);
      expect(parse(bytes)).toEqual(expected);
      const profile = readIccProfile(bytes);
      const encoded = Buffer.from(writeIccProfile(profile));
      expect(referenceParse(encoded)).toEqual(expected);
      expect(parse(encoded)).toEqual(expected);
      const decoded = readIccProfile(encoded).tags;
      expect(decoded).toHaveLength(profile.tags.length);
      decoded.forEach((tag, i) => {
        expect(tag.signature).toBe(profile.tags[i].signature);
        expect(Buffer.from(tag.data).equals(profile.tags[i].data)).toBe(true);
      });
    });
  }
  const corpus = process.env.ICC_COMPAT_CORPUS ?? '/System/Library/ColorSync/Profiles';
  const files = existsSync(corpus) ? readdirSync(corpus).filter((file) => /\.(icc|icm)$/i.test(file)) : [];
  if (files.length === 0) it.skip('installed profile corpus is unavailable', () => {});
  for (const file of files) {
    it(`matches installed profile ${file} before and after writing`, () => {
      const bytes = readFileSync(join(corpus, file));
      const expected = referenceParse(bytes);
      expect(parse(bytes)).toEqual(expected);
      const profile = readIccProfile(bytes);
      const encoded = Buffer.from(writeIccProfile(profile));
      expect(referenceParse(encoded)).toEqual(expected);
      expect(parse(encoded)).toEqual(expected);
      expect(readIccProfile(encoded).tags).toEqual(profile.tags);
    });
  }
  for (const name of ['color/display_p3', 'color/adobe_rgb', 'color/prophoto', 'color/pq_icc', 'icc_rec2020_pq']) {
    it(`matches metadata before and after writing the libjxl ${name} profile`, () => {
      const bytes = readFileSync(new URL(`../../../assets/jxl/${name}.icc`, import.meta.url));
      const expected = referenceParse(bytes);
      expect(parse(bytes)).toEqual(expected);
      const profile = readIccProfile(bytes);
      const encoded = Buffer.from(writeIccProfile(profile));
      expect(referenceParse(encoded)).toEqual(expected);
      expect(parse(encoded)).toEqual(expected);
      expect(readIccProfile(encoded).tags).toEqual(profile.tags);
      // Buffer pools and embedding containers must not change byte offsets.
      const embedded = Buffer.concat([Buffer.alloc(19, 255), bytes, Buffer.alloc(13, 255)]);
      expect(parse(embedded.subarray(19, 19 + bytes.length))).toEqual(expected);
    });
  }

  for (const signature of ['desc', 'cprt', 'dmdd', 'vued', 'wtpt']) {
    for (const [type, data] of Object.entries({ desc, text, mluc, xyz })) {
      it(`matches ${signature} carrying ${type}, including upstream cross-type behaviour`, () => {
        const bytes = fixture([{ signature, data }]);
        const expected = referenceParse(bytes);
        expect(parse(bytes)).toEqual(expected);
        expect(referenceParse(Buffer.from(writeIccProfile(readIccProfile(bytes))))).toEqual(expected);
      });
    }
  }

  it('preserves unknown tags and resolves duplicate supported tags like icc', () => {
    const bytes = fixture([
      { signature: 'desc', data: desc },
      { signature: 'desc', data: mluc },
      { signature: 'desc', data: Buffer.from('priv\0\0\0\0opaque') },
      { signature: 'zzzz', data: text },
    ]);
    const expected = referenceParse(bytes);
    expect(expected.description).toBe('色彩🌈!');
    expect(parse(bytes)).toEqual(expected);
    const profile = readIccProfile(bytes);
    const rewritten = Buffer.from(writeIccProfile(profile));
    expect(referenceParse(rewritten)).toEqual(expected);
    expect(readIccProfile(rewritten).tags).toEqual(profile.tags);
  });

  it('keeps metadata decoding independent of RGB transform support', () => {
    for (const space of ['CMYK', 'GRAY', 'Lab ', '7CLR']) {
      const bytes = fixture([{ signature: 'desc', data: mluc }]);
      bytes.write(space, 16, 'ascii');
      bytes.write('prtr', 12, 'ascii');
      expect(parse(bytes)).toEqual(referenceParse(bytes));
      expect(referenceParse(Buffer.from(writeIccProfile(readIccProfile(bytes))))).toEqual(referenceParse(bytes));
    }
  });
});
