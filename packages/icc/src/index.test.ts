import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readIccCicp, readIccProfile, writeIccProfile } from './index.js';
const load = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../assets/jxl/color/${name}.icc`, import.meta.url)));
describe('ICC profile I/O', () => {
  it('reads libjxl matrix/TRC profiles and roundtrips unknown tag payloads', () => {
    for (const name of ['display_p3', 'adobe_rgb', 'prophoto']) {
      const p = readIccProfile(load(name));
      p.tags.push({ signature: 'abcd', data: new Uint8Array([1, 3, 5]) });
      const q = readIccProfile(writeIccProfile(p));
      expect(q.tags).toEqual(p.tags);
      expect([...q.header.subarray(84, 100)]).toEqual(Array(16).fill(0));
    }
  });
  it('reads HDR cicp independently of legacy LUT tags', () => {
    const p = readIccProfile(load('pq_icc'));
    expect(readIccCicp(p)).toEqual({ primaries: 9, transfer: 16, matrix: 0, fullRange: true });
    expect(readIccCicp(readIccProfile(load('adobe_rgb')))).toBeUndefined();
  });
  it('bounds-checks headers, counts and offsets before reading any payload', () => {
    expect(() => readIccProfile(new Uint8Array(132))).toThrow('header');
    const original = load('display_p3');
    for (const [off, value] of [
      [0, original.length + 1],
      [128, 0xffffffff],
      [136, 0xffffffff],
      [140, 0xffffffff],
    ]) {
      const b = original.slice();
      new DataView(b.buffer).setUint32(off, value);
      expect(() => readIccProfile(b)).toThrow();
    }
    expect(() => writeIccProfile({ header: new Uint8Array(128), tags: [] })).toThrow('header');
    const p = readIccProfile(original);
    p.tags[0].signature = 'x';
    expect(() => writeIccProfile(p)).toThrow('four bytes');
  });
});

it('reads and rewrites shared tag ranges without amplifying payload allocation', () => {
  const source = readIccProfile(load('adobe_rgb'));
  const payload = new Uint8Array(4096).fill(7);
  source.tags = Array.from({ length: 1000 }, () => ({ signature: 'data', data: payload }));
  const encoded = Buffer.from(writeIccProfile(source));
  expect(encoded.length).toBe(132 + 1000 * 12 + 4096);
  const parsed = readIccProfile(encoded);
  expect(new Set(parsed.tags.map((t) => t.data.buffer)).size).toBe(1);
  expect(new Set(parsed.tags.map((t) => t.data.byteOffset)).size).toBe(1);
  expect(parsed.tags[0].data.buffer).not.toBe(encoded.buffer);
  const offset = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength).getUint32(136);
  encoded[offset] = 99;
  expect(parsed.tags[0].data[0]).toBe(7);
  const rewritten = writeIccProfile(parsed);
  expect(rewritten.length).toBe(encoded.length);
  expect(readIccProfile(rewritten).tags[999].data).toEqual(payload);
});

it('coalesces overlapping payloads and aligns unaligned caller views', () => {
  const profile = readIccProfile(load('adobe_rgb'));
  const storage = Uint8Array.from({ length: 8192 }, (_, i) => i % 251);
  profile.tags = Array.from({ length: 1000 }, (_, i) => ({
    signature: 'data',
    data: storage.subarray(i % 100, (i % 100) + 4096),
  }));
  const encoded = writeIccProfile(profile);
  expect(encoded.length).toBeLessThan(132 + 12000 + storage.length * 4);
  const d = new DataView(encoded.buffer);
  for (let i = 0; i < 1000; i++) expect(d.getUint32(136 + i * 12) % 4).toBe(0);
  expect(readIccProfile(encoded).tags).toEqual(profile.tags);
});

it('provides independent default sRGB profiles and owned ADGC GUIDs', async () => {
  const { createSrgbIccProfile, readIccAdgcGuid } = await import('./index.js');
  const bytes = createSrgbIccProfile();
  expect(bytes.length).toBe(456);
  const p = readIccProfile(bytes);
  bytes.fill(0);
  expect(readIccProfile(createSrgbIccProfile()).tags).toEqual(p.tags);
  expect(readIccAdgcGuid(p)).toBeUndefined();
  const data = Uint8Array.from({ length: 28 }, (_, i) => i);
  p.tags.push({ signature: 'ADGC', data });
  const guid = readIccAdgcGuid(p)!;
  expect(guid).toEqual(data.slice(12));
  guid.fill(0);
  expect(readIccAdgcGuid(p)).toEqual(data.slice(12));
  p.tags.at(-1)!.data = data.subarray(0, 27);
  expect(readIccAdgcGuid(p)).toBeUndefined();
});
