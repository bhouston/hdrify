import { parse as referenceParse } from 'icc';
import { describe, expect, it } from 'vitest';
import { readIccProfile, writeIccProfile } from './index.js';
import {
  readIccLocalizedText,
  readIccTagValue,
  writeIccDescription,
  writeIccLocalizedText,
  writeIccText,
  writeIccXyz,
} from './tags.js';

const profileWith = (signature: string, data: Uint8Array) => {
  const header = new Uint8Array(128);
  header.set([97, 99, 115, 112], 36);
  return writeIccProfile({ header, tags: [{ signature, data }] });
};
const set32 = (bytes: Uint8Array, offset: number, value: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.length).setUint32(offset, value);

describe('ICC metadata tag codecs', () => {
  for (const [signature, property] of [
    ['desc', 'description'],
    ['cprt', 'copyright'],
    ['dmdd', 'deviceModelDescription'],
    ['vued', 'viewingConditionsDescription'],
  ] as const) {
    for (const [type, payload, expected] of [
      ['desc', writeIccDescription('Metadata ASCII'), 'Metadata ASCII'],
      ['text', writeIccText('Copyright 2026'), 'Copyright 2026'],
      [
        'mluc',
        writeIccLocalizedText([
          { language: 'ja', country: 'JP', text: '色空間 🌈' },
          { language: 'en', country: 'US', text: 'Colour space' },
        ]),
        '色空間 🌈',
      ],
    ] as const) {
      it(`authors ${type} in ${signature} that icc parses as ${property}`, () => {
        const bytes = profileWith(signature, payload);
        expect(referenceParse(Buffer.from(bytes))[property]).toBe(expected);
        expect(readIccTagValue(readIccProfile(bytes).tags[0].data)).toBe(expected);
      });
    }
  }
  it('reads independently constructed desc/text/XYZ payloads', () => {
    const desc = Uint8Array.from([100, 101, 115, 99, 0, 0, 0, 0, 0, 0, 0, 4, 82, 71, 66, 0]);
    expect(readIccTagValue(desc)).toBe('RGB');
    const text = Uint8Array.from([116, 101, 120, 116, 0, 0, 0, 0, 65, 0, 66, 0, 0]);
    expect(readIccTagValue(text)).toBe('A\0B');
    const xyz = Uint8Array.from([88, 89, 90, 32, 0, 0, 0, 0, 0, 1, 0, 0, 255, 255, 128, 0, 0, 0, 64, 0]);
    expect(readIccTagValue(xyz)).toEqual([1, -0.5, 0.25]);
  });
  it('authors signed XYZ and matches icc independently', () => {
    const payload = writeIccXyz([0.9642, 1, -0.5]);
    const expected = [Math.round(0.9642 * 65536) / 65536, 1, -0.5];
    expect(readIccTagValue(payload)).toEqual(expected);
    expect(referenceParse(Buffer.from(profileWith('wtpt', payload))).whitepoint).toEqual(expected);
    expect(readIccTagValue(writeIccXyz([-32768, 0, 0x7fffffff / 65536]))).toEqual([-32768, 0, 0x7fffffff / 65536]);
  });
  it('preserves localized entries, empty strings, BOM and nonzero byte offsets', () => {
    const records = [
      { language: 'fr', country: '', text: '\ufeffCrème' },
      { language: 'en', country: 'GB', text: '' },
    ];
    const payload = writeIccLocalizedText(records);
    const outer = new Uint8Array(payload.length + 13);
    outer.set(payload, 7);
    const sliced = outer.subarray(7, 7 + payload.length);
    expect(readIccLocalizedText(sliced)).toEqual(records);
    expect(readIccTagValue(sliced)).toBe(records[0].text);
    expect(referenceParse(Buffer.from(profileWith('desc', sliced))).description).toBe(records[0].text);
    expect(readIccLocalizedText(writeIccLocalizedText([]))).toEqual([]);
    expect(readIccTagValue(writeIccLocalizedText([]))).toBeUndefined();
    expect(readIccLocalizedText(writeIccText('hello'))).toBeUndefined();
    expect(readIccTagValue(writeIccText(''))).toBe('');
    expect(readIccTagValue(writeIccDescription(''))).toBe('');
  });
  it('writes complete legacy description extensions with zero-filled unused fields', () => {
    const payload = writeIccDescription('RGB');
    expect(payload.length).toBe(12 + 4 + 78);
    expect([...payload.subarray(16)]).toEqual(Array(78).fill(0));
    const zeroCount = new Uint8Array(12);
    zeroCount.set([100, 101, 115, 99]);
    expect(readIccTagValue(zeroCount)).toBe('');
  });
  it('keeps unknown tag types opaque', () => {
    expect(readIccTagValue(new Uint8Array(0))).toBeUndefined();
    expect(readIccTagValue(Uint8Array.from([112, 114, 105, 118, 1, 2, 3, 4]))).toBeUndefined();
  });
  it('rejects malformed recognized payloads within tag-local bounds', () => {
    for (const payload of [
      writeIccText('x').subarray(0, 7),
      writeIccDescription('x').subarray(0, 11),
      writeIccXyz([1, 1, 1]).subarray(0, 19),
      writeIccLocalizedText([]).subarray(0, 15),
    ]) {
      expect(() => readIccTagValue(payload)).toThrow();
    }
    const desc = writeIccDescription('test');
    set32(desc, 8, desc.length);
    expect(() => readIccTagValue(desc)).toThrow();
    const unterminated = writeIccDescription('test');
    unterminated[16] = 1;
    expect(() => readIccTagValue(unterminated)).toThrow();
    const valid = writeIccLocalizedText([{ language: 'en', country: 'US', text: 'abc' }]);
    for (const [offset, value] of [
      [8, 0xffffffff],
      [12, 16],
      [20, 3],
      [20, 0xffffffff],
      [24, 0],
      [24, valid.length + 1],
    ] as const) {
      const malformed = valid.slice();
      set32(malformed, offset, value);
      expect(() => readIccTagValue(malformed)).toThrow();
    }
    const surrogate = valid.slice();
    surrogate.set([0xd8, 0, 0, 65], 28);
    expect(() => readIccTagValue(surrogate)).toThrow();
  });
  it('validates authored text, language codes, and fixed-point ranges', () => {
    for (const text of ['é', 'a\0b']) {
      expect(() => writeIccText(text)).toThrow('ASCII');
      expect(() => writeIccDescription(text)).toThrow('ASCII');
    }
    for (const record of [
      { language: 'eng', country: 'US', text: 'x' },
      { language: 'en', country: 'USA', text: 'x' },
      { language: 'en', country: 'US', text: '\ud800' },
    ])
      expect(() => writeIccLocalizedText([record])).toThrow();
    for (const value of [NaN, Infinity, -32769, 32768]) expect(() => writeIccXyz([value, 1, 1])).toThrow('range');
  });
});
