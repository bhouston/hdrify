import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readIccProfile, writeIccProfile } from 'hdrify-icc';
import { readIccCurve, readIccRgbTransform } from './iccTransform.js';
const load = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../../assets/jxl/color/${name}.icc`, import.meta.url)));
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

describe('ICC RGB matrix/TRC interpretation', () => {
  it('interprets supported profiles after profile data round trips', () => {
    for (const name of ['display_p3', 'adobe_rgb', 'prophoto']) {
      const profile = readIccProfile(load(name));
      expect(readIccRgbTransform(profile)?.curves[0].evaluate(1)).toBeCloseTo(1, 3);
      expect(readIccRgbTransform(readIccProfile(writeIccProfile(profile)))).toBeDefined();
    }
    expect(readIccRgbTransform(readIccProfile(load('pq_icc')))).toBeUndefined();
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
});
