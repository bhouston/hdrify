import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readIccCicp, readIccCurve, readIccProfile, readIccRgbTransform, writeIccProfile } from './index.js';
const load = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../assets/jxl/color/${name}.icc`, import.meta.url)));
const parametric = (type: number, parameters: number[]) => {
  const b = new Uint8Array(12 + parameters.length * 4),
    d = new DataView(b.buffer);
  b.set([112, 97, 114, 97]);
  d.setUint16(8, type);
  parameters.forEach((v, i) => d.setInt32(12 + i * 4, Math.round(v * 65536)));
  return b;
};
const table = (values: number[]) => {
  const b = new Uint8Array(12 + values.length * 2),
    d = new DataView(b.buffer);
  b.set([99, 117, 114, 118]);
  d.setUint32(8, values.length);
  values.forEach((v, i) => d.setUint16(12 + i * 2, v));
  return b;
};

describe('ICC curves', () => {
  for (const [type, params, low, high] of [
    [0, [2], 0.01, 0.64],
    [1, [2, 1, -0.25], 0, 0.3025],
    [2, [2, 1, -0.25, 0.125], 0.125, 0.4275],
    [3, [2, 1, 0, 0.5, 0.25], 0.05, 0.64],
    [4, [2, 1, 0, 0.5, 0.25, 0.125, 0.25], 0.3, 0.765],
  ] as const) {
    it(`evaluates parametric type ${type} on both sides of its breakpoint`, () => {
      const c = readIccCurve(parametric(type, [...params]))!;
      expect(c.evaluate(0.1)).toBeCloseTo(low, 5);
      expect(c.evaluate(0.8)).toBeCloseTo(high, 5);
      expect(c.inverse(c.evaluate(0.8))).toBeCloseTo(0.8, 7);
      expect(c.inverse(c.evaluate(1.5))).toBeCloseTo(1.5, 7);
    });
  }
  it('handles identity, gamma and interpolated tables with domain clamping', () => {
    expect(readIccCurve(table([]))!.evaluate(0.4)).toBe(0.4);
    expect(readIccCurve(table([]))!.inverse(3)).toBe(3);
    expect(readIccCurve(table([512]))!.inverse(4)).toBe(2);
    expect(readIccCurve(table([512]))!.evaluate(0.5)).toBe(0.25);
    const c = readIccCurve(table([0, 16384, 65535]))!;
    expect(c.evaluate(0.25)).toBeCloseTo(8192 / 65535, 8);
    expect(c.inverse(0.5)).toBeCloseTo(2 / 3, 4);
    expect(c.inverse(-1)).toBe(0);
    expect(c.inverse(2)).toBe(1);
    expect(c.evaluate(-1)).toBe(0);
    expect(c.evaluate(3)).toBe(1);
  });
  it('rejects truncated curves and leaves unsupported curve functions explicit', () => {
    expect(() => readIccCurve(new Uint8Array(3))).toThrow('truncated');
    expect(() => readIccCurve(table([512]).subarray(0, 12))).toThrow('truncated');
    expect(() => readIccCurve(parametric(4, [2]))).toThrow('truncated');
    expect(readIccCurve(parametric(99, []))).toBeUndefined();
    expect(readIccCurve(new Uint8Array(12))).toBeUndefined();
  });
});

describe('ICC profile I/O', () => {
  it('reads libjxl matrix/TRC profiles and roundtrips unknown tag payloads', () => {
    for (const name of ['display_p3', 'adobe_rgb', 'prophoto']) {
      const p = readIccProfile(load(name)),
        t = readIccRgbTransform(p)!;
      expect(t).toBeDefined();
      expect(t.curves[0].evaluate(1)).toBeCloseTo(1, 3);
      p.tags.push({ signature: 'abcd', data: new Uint8Array([1, 3, 5]) });
      const q = readIccProfile(writeIccProfile(p));
      expect(q.tags).toEqual(p.tags);
      expect(readIccRgbTransform(q)).toBeDefined();
      expect([...q.header.subarray(84, 100)]).toEqual(Array(16).fill(0));
    }
  });
  it('reads HDR cicp independently of legacy LUT tags', () => {
    const p = readIccProfile(load('pq_icc'));
    expect(readIccCicp(p)).toEqual({ primaries: 9, transfer: 16, matrix: 0, fullRange: true });
    expect(readIccRgbTransform(p)).toBeUndefined();
    expect(readIccCicp(readIccProfile(load('adobe_rgb')))).toBeUndefined();
  });
  it('does not mistake LUT, non-RGB, or incomplete profiles for matrix/TRC profiles', () => {
    const p = readIccProfile(load('display_p3'));
    p.tags.push({ signature: 'A2B0', data: new Uint8Array(12) });
    expect(readIccRgbTransform(p)).toBeUndefined();
    p.tags.pop();
    p.tags = p.tags.filter((t) => t.signature !== 'rTRC');
    expect(readIccRgbTransform(p)).toBeUndefined();
    p.header.set([67, 77, 89, 75], 16);
    expect(readIccRgbTransform(p)).toBeUndefined();
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
  const decoded = readIccProfile(encoded).tags;
  expect(decoded).toHaveLength(profile.tags.length);
  for (let i = 0; i < decoded.length; i++) {
    expect(decoded[i].signature).toBe(profile.tags[i].signature);
    // Compare every byte natively; generic deep equality visits millions of numeric properties.
    expect(Buffer.from(decoded[i].data).equals(profile.tags[i].data)).toBe(true);
  }
});

it('provides independent default sRGB profiles and owned ADGC GUIDs', async () => {
  const { createSrgbIccProfile, readIccAdgcGuid } = await import('./index.js');
  const bytes = createSrgbIccProfile();
  expect(bytes.length).toBe(456);
  const p = readIccProfile(bytes);
  const t = readIccRgbTransform(p)!;
  expect(t.curves[0].evaluate(0.5)).toBeCloseTo(0.21404, 4);
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
