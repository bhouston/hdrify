import { describe, expect, it } from 'vitest';
import { linearTosRGB, sRGBToLinear } from './srgb.js';

describe('sRGBToLinear', () => {
  it('maps 0 to 0', () => {
    expect(sRGBToLinear(0)).toBe(0);
  });

  it('maps 1 to 1', () => {
    expect(sRGBToLinear(1)).toBeCloseTo(1, 14);
  });

  it('maps sRGB knee 0.04045 to linear ~0.0031308', () => {
    const linear = sRGBToLinear(0.04045);
    expect(linear).toBeCloseTo(0.04045 / 12.92, 10);
    expect(linear).toBeCloseTo(0.0031308, 4);
  });

  it('linear 0.5 corresponds to sRGB ~0.735 (midtone)', () => {
    const sRGB = 0.735;
    const linear = sRGBToLinear(sRGB);
    expect(linear).toBeCloseTo(0.5, 2);
  });

  it('values just below knee use linear segment', () => {
    const x = 0.04;
    expect(sRGBToLinear(x)).toBe(x / 12.92);
  });

  it('values just above knee use power segment', () => {
    const x = 0.05;
    const out = sRGBToLinear(x);
    expect(out).toBeCloseTo(((x + 0.055) / 1.055) ** 2.4, 10);
  });
});

describe('linearTosRGB', () => {
  it('maps 0 to 0', () => {
    expect(linearTosRGB(0)).toBe(0);
  });

  it('maps 1 to 1', () => {
    expect(linearTosRGB(1)).toBeCloseTo(1, 14);
  });

  it('maps linear ~0.0031308 to sRGB 0.04045', () => {
    const linear = 0.0031308;
    const sRGB = linearTosRGB(linear);
    expect(sRGB).toBeCloseTo(0.04045, 4);
  });

  it('linear 0.5 corresponds to sRGB ~0.735 (midtone)', () => {
    const linear = 0.5;
    const sRGB = linearTosRGB(linear);
    expect(sRGB).toBeCloseTo(0.735, 2);
  });

  it('values just below knee use linear segment', () => {
    const x = 0.003;
    expect(linearTosRGB(x)).toBe(x * 12.92);
  });

  it('values just above knee use power segment', () => {
    const x = 0.004;
    const out = linearTosRGB(x);
    expect(out).toBeCloseTo(1.055 * x ** (1 / 2.4) - 0.055, 10);
  });
});

describe('round-trip sRGBToLinear(linearTosRGB(x))', () => {
  const samples = [0, 0.001, 0.003, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1];

  it('recovers linear x for sample values', () => {
    for (const x of samples) {
      const back = sRGBToLinear(linearTosRGB(x));
      expect(back).toBeCloseTo(x, 10);
    }
  });
});

describe('round-trip linearTosRGB(sRGBToLinear(x))', () => {
  const samples = [0, 0.01, 0.04, 0.05, 0.2, 0.5, 0.735, 0.9, 1];

  it('recovers sRGB x for sample values', () => {
    for (const x of samples) {
      const back = linearTosRGB(sRGBToLinear(x));
      expect(back).toBeCloseTo(x, 8);
    }
  });

  it('recovers sRGB 0.04045 (knee) within float precision', () => {
    const x = 0.04045;
    const back = linearTosRGB(sRGBToLinear(x));
    expect(Math.abs(back - x)).toBeLessThan(1e-6);
  });
});
