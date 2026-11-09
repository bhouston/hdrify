import { parse as referenceParse } from 'icc';
import { describe, expect, it } from 'vitest';
import { parse, readIccHeaderMetadata, readIccMetadata } from './metadata.js';
import { readIccProfile } from './index.js';

/** Hand-encoded zero-tag profile, independent of hdrify's serializer. */
const fixture = () => {
  const b = Buffer.alloc(132);
  b.writeUInt32BE(b.length, 0);
  b.write('acsp', 36);
  b.writeUInt32BE(0x04300000, 8);
  return b;
};
const signatureFields = [4, 12, 16, 20, 40, 48, 52, 80];

describe('icc 4.0.0 header compatibility', () => {
  it('matches every supported version and rendering intent, including unknown values', () => {
    for (const version of [
      0x02000000, 0x02100000, 0x02400000, 0x04000000, 0x04200000, 0x04300000, 0x04400000, 0x02300000, 0xffffffff,
    ]) {
      for (const intent of [0, 1, 2, 3, 4, 0xffffffff]) {
        const b = fixture();
        b.writeUInt32BE(version, 8);
        b.writeUInt32BE(intent, 64);
        expect(parse(b)).toStrictEqual(referenceParse(b));
        expect(readIccHeaderMetadata(b.subarray(0, 128))).toStrictEqual(referenceParse(b));
      }
    }
  });

  it('matches friendly names in every signature field, preserving unknown spelling', () => {
    // icc intentionally uses one name map for all header signature fields.
    for (const value of [
      'scnr',
      'mntr',
      'prtr',
      'link',
      'abst',
      'spac',
      'nmcl',
      'appl',
      'adbe',
      'msft',
      'sunw',
      'sgi ',
      'tgnt',
      'MNTR',
      'ApPl',
      ' RGB',
      'XYZ ',
      'CMYK',
      'GRAY',
      'Lab ',
      '7CLR',
      'AbCd',
      '    ',
    ]) {
      const b = fixture();
      for (const offset of signatureFields) b.write(value, offset, 4, 'ascii');
      expect(parse(b)).toStrictEqual(referenceParse(b));
    }
  });

  it('omits zero signature fields and preserves undefined version and intent keys', () => {
    const b = fixture();
    b.writeUInt32BE(0, 8);
    b.writeUInt32BE(9, 64);
    expect(parse(b)).toStrictEqual({ version: undefined, intent: undefined });
    expect(parse(b)).toStrictEqual(referenceParse(b));
    for (const offset of signatureFields) {
      const only = b.slice();
      only.write('cust', offset);
      expect(parse(only)).toStrictEqual(referenceParse(only));
    }
  });

  it('accepts offset Buffer and Uint8Array views without reading surrounding bytes', () => {
    const b = fixture();
    b.write('prtr', 12);
    b.write('CMYK', 16);
    const surrounding = Buffer.alloc(b.length + 19, 0xff);
    b.copy(surrounding, 7);
    const sliced = surrounding.subarray(7, 7 + b.length);
    const typed = new Uint8Array(sliced.buffer, sliced.byteOffset, sliced.byteLength);
    expect(parse(sliced)).toStrictEqual(referenceParse(sliced));
    expect(parse(typed)).toStrictEqual(referenceParse(b));
    expect(readIccMetadata(readIccProfile(typed))).toStrictEqual(referenceParse(b));
  });

  it('requires exact length only for the compatible parse entry point', () => {
    const b = fixture();
    const withTrailing = Buffer.concat([b, Buffer.from([1, 2, 3])]);
    expect(() => referenceParse(withTrailing)).toThrow();
    expect(() => parse(withTrailing)).toThrow('length mismatch');
    expect(readIccMetadata(readIccProfile(withTrailing))).toStrictEqual(referenceParse(b));
    expect(() => parse(b.subarray(0, 131))).toThrow();
    expect(() => parse(new Uint8Array())).toThrow();
  });

  it('validates standalone header length and signature', () => {
    const b = fixture();
    expect(() => readIccHeaderMetadata(b)).toThrow('header');
    expect(() => readIccHeaderMetadata(b.subarray(0, 127))).toThrow('header');
    b.write('oops', 36);
    expect(() => readIccHeaderMetadata(b.subarray(0, 128))).toThrow('header');
    expect(() => parse(b)).toThrow('header');
    expect(() => referenceParse(b)).toThrow();
  });
});
