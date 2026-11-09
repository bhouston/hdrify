import { describe, expect, it } from 'vitest';
import {
  createSrgbIccProfile,
  getIccTag,
  readIccHeader,
  readIccProfile,
  removeIccTags,
  setIccTag,
  writeIccHeader,
  writeIccProfile,
} from './index.js';

describe('ICC data editing', () => {
  it('roundtrips every header byte, including unknown values, reserved fields and v2 data', () => {
    const header = readIccHeader(createSrgbIccProfile());
    header.version = 0x02100000;
    header.deviceAttributes = 0xfedcba9876543210n;
    header.flags = 0xf0000003;
    header.renderingIntent = 0xffffffff;
    header.creationDate = [2026, 11, 9, 12, 34, 56];
    header.preferredCmm = '\0\0\0\0';
    header.platform = 'ABCD';
    header.manufacturer = '\xff\0\0\0';
    header.model = 'test';
    header.creator = 'demo';
    header.illuminant = [-0.5, 1, 32767.5];
    header.profileId.fill(199);
    header.reserved.fill(243);
    const encoded = writeIccHeader(header);
    expect(readIccHeader(encoded)).toEqual(header);
    expect(writeIccHeader(readIccHeader(encoded))).toEqual(encoded);
    const storage = new Uint8Array(133);
    storage.set(encoded, 3);
    expect(readIccHeader(storage.subarray(3, 131))).toEqual(header);
    const buffer = Buffer.from(encoded);
    const decoded = readIccHeader(buffer);
    buffer.fill(0);
    expect(decoded.profileId[0]).toBe(199);
    expect(decoded.reserved[0]).toBe(243);
    encoded.fill(0);
    expect(header.profileId[0]).toBe(199);
  });

  for (const [space, pcs, version] of [
    ['CMYK', 'Lab ', 0x02100000],
    ['GRAY', 'XYZ ', 0x04400000],
    ['7CLR', 'Lab ', 0x04300000],
  ] as const) {
    it(`preserves ${space} LUT and unknown data without interpreting pixels`, () => {
      const p = readIccProfile(createSrgbIccProfile());
      const h = readIccHeader(p.header);
      h.colorSpace = space;
      h.pcs = pcs;
      h.version = version;
      p.header = writeIccHeader(h);
      const opaque = Uint8Array.from({ length: 81 }, (_, i) => i * 3);
      p.tags = [
        { signature: 'A2B0', data: opaque },
        { signature: 'B2A0', data: opaque.subarray(4) },
        { signature: 'zzzz', data: Uint8Array.of(255, 0, 42) },
      ];
      const source = writeIccProfile(p);
      const edit = readIccProfile(source);
      const original = edit.tags.map((tag) => ({ signature: tag.signature, data: tag.data.slice() }));
      const custom = Uint8Array.of(1, 2, 3);
      setIccTag(edit, 'meta', custom);
      custom.fill(0);
      expect(getIccTag(edit, 'meta')!.data).toEqual(Uint8Array.of(1, 2, 3));
      setIccTag(edit, 'meta', Uint8Array.of(7));
      expect(edit.tags).toHaveLength(4);
      expect(removeIccTags(edit, 'none')).toBe(0);
      edit.tags.push({ signature: 'meta', data: Uint8Array.of(8) });
      expect(removeIccTags(edit, 'meta')).toBe(2);
      const result = readIccProfile(writeIccProfile(edit));
      expect(result.tags).toEqual(original);
      expect(readIccHeader(result.header)).toEqual(readIccHeader(readIccProfile(source).header));
      expect(getIccTag(result, 'none')).toBeUndefined();
    });
  }

  it('rejects invalid header edits instead of silently wrapping or truncating', () => {
    const original = readIccHeader(createSrgbIccProfile());
    for (const edit of [
      { profileSize: -1 },
      { version: 0x100000000 },
      { flags: 1.5 },
      { creator: 'x' },
      { model: '💡xx' },
      { creationDate: [1, 2] },
      { creationDate: [1, 2, 3, 4, 5, 65536] },
      { illuminant: [1, 2] },
      { illuminant: [Infinity, 1, 1] },
      { illuminant: [32768, 1, 1] },
      { deviceAttributes: -1n },
      { deviceAttributes: 0x10000000000000000n },
      { profileId: new Uint8Array(15) },
      { reserved: new Uint8Array(27) },
    ])
      expect(() => writeIccHeader({ ...original, ...edit } as typeof original)).toThrow('ICC');
    expect(() => readIccHeader(new Uint8Array(127))).toThrow('header');
    expect(() => readIccHeader(new Uint8Array(128))).toThrow('header');
    expect(() => setIccTag(readIccProfile(createSrgbIccProfile()), 'x', new Uint8Array())).toThrow('signature');
  });
});
