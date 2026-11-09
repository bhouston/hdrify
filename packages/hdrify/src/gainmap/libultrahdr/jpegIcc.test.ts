import { createSrgbIccProfile, readIccProfile, writeIccProfile } from 'hdrify-icc';
import { describe, expect, it } from 'vitest';
import { getAdgcGuidFromIccProfile, iccProfileHasAdgcTag } from './iccFromJpeg.js';
import { buildJpegIccPayloads, extractJpegIccProfile } from './jpegIcc.js';
import { buildSrgbIccPayload } from './srgbIccProfile.js';

function jpeg(payloads: Uint8Array[], suffix = Uint8Array.of(255, 217)): Uint8Array {
  const out = new Uint8Array(2 + payloads.reduce((n, p) => n + p.length + 4, 0) + suffix.length);
  out.set([255, 216]);
  let pos = 2;
  for (const p of payloads) {
    out.set([255, 226, (p.length + 2) >>> 8, (p.length + 2) & 255], pos);
    out.set(p, pos + 4);
    pos += p.length + 4;
  }
  out.set(suffix, pos);
  return out;
}

function largeProfile(): Uint8Array {
  const profile = readIccProfile(createSrgbIccProfile());
  profile.tags.push({ signature: 'test', data: Uint8Array.from({ length: 140000 }, (_, i) => i % 251) });
  return writeIccProfile(profile);
}

describe('JPEG ICC transport', () => {
  it('preserves the default profile and assembles reordered multipart payloads from subarray views', () => {
    expect(extractJpegIccProfile(jpeg([buildSrgbIccPayload()]))).toEqual(createSrgbIccProfile());
    const source = largeProfile();
    const chunks = buildJpegIccPayloads(source);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(65533);
    const encoded = jpeg(chunks.slice().reverse());
    const storage = new Uint8Array(encoded.length + 9);
    storage.set(encoded, 5);
    expect(extractJpegIccProfile(storage.subarray(5, 5 + encoded.length))).toEqual(source);
    expect(readIccProfile(source).tags.at(-1)!.data[999]).toBe(999 % 251);
  });

  it('rejects duplicate, missing, zero, out-of-range, and contradictory chunk sequences', () => {
    const chunks = buildJpegIccPayloads(largeProfile());
    expect(() => extractJpegIccProfile(jpeg(chunks.slice(1)))).toThrow('sequence');
    expect(() => extractJpegIccProfile(jpeg([...chunks, chunks[0]]))).toThrow('sequence');
    for (const [position, value] of [
      [12, 0],
      [12, 4],
      [13, 0],
      [13, 2],
    ]) {
      const changed = chunks.map((c) => c.slice());
      changed[0][position] = value!;
      expect(() => extractJpegIccProfile(jpeg(changed))).toThrow('sequence');
    }
    expect(() => extractJpegIccProfile(jpeg([chunks[0].subarray(0, 12)]))).toThrow('sequence');
  });

  it('bounds-checks JPEG headers and does not search scans or secondary images', () => {
    const profileJpeg = jpeg(buildJpegIccPayloads(createSrgbIccProfile()));
    expect(extractJpegIccProfile(jpeg([], Uint8Array.of(255, 217, ...profileJpeg)))).toBeNull();
    expect(extractJpegIccProfile(jpeg([], Uint8Array.of(255, 218, 0, 2, ...profileJpeg)))).toBeNull();
    expect(extractJpegIccProfile(jpeg([new Uint8Array([1, 2, 3])]))).toBeNull();
    for (const bytes of [
      [],
      [255, 216],
      [255, 216, 1],
      [255, 216, 255],
      [255, 216, 255, 226, 0],
      [255, 216, 255, 226, 0, 1],
      [255, 216, 255, 226, 255, 255],
      [255, 216, 255, 0],
      [255, 216, 255, 216],
    ]) {
      expect(() => extractJpegIccProfile(Uint8Array.from(bytes))).toThrow('header');
    }
    expect(extractJpegIccProfile(Uint8Array.of(255, 216, 255, 255, 1, 255, 208, 255, 217))).toBeNull();
  });

  it('validates profiles and rejects profiles that exceed the JPEG chunk count', () => {
    expect(() => buildJpegIccPayloads(new Uint8Array(132))).toThrow('ICC');
    expect(() => buildJpegIccPayloads(new Uint8Array(65519 * 255 + 1))).toThrow('255');
  });
});

it('delegates ADGC parsing to the shared profile reader while retaining null-on-invalid compatibility', () => {
  const p = readIccProfile(createSrgbIccProfile());
  expect(iccProfileHasAdgcTag(writeIccProfile(p))).toBe(false);
  const data = Uint8Array.from({ length: 28 }, (_, i) => i);
  p.tags.push({ signature: 'ADGC', data });
  const bytes = writeIccProfile(p);
  expect(getAdgcGuidFromIccProfile(bytes)).toEqual(data.slice(12));
  expect(iccProfileHasAdgcTag(bytes)).toBe(true);
  expect(getAdgcGuidFromIccProfile(new Uint8Array(132))).toBeNull();
});
