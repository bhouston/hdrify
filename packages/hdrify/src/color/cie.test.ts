import { describe, expect, it } from 'vitest';
import { CHROMATICITIES_REC709, CHROMATICITIES_REC2020 } from './chromaticities.js';
import { xyToLinearRgb, xyYToXyz, xyzToLinearRgb } from './cie.js';
import { chromaticitiesToRgbXyzMatrix } from './matrixConversion.js';

describe('xyYToXyz', () => {
  it('converts D65 white (x≈0.3127, y≈0.329, Y=1) to XYZ in expected range', () => {
    const { x, y, z } = xyYToXyz(0.3127, 0.329, 1);
    expect(x).toBeGreaterThan(0.9);
    expect(x).toBeLessThan(1.1);
    expect(y).toBe(1);
    expect(z).toBeGreaterThan(0.9);
    expect(z).toBeLessThan(1.1);
  });

  it('returns black when y (chromaticity) is near zero', () => {
    const { x, y, z } = xyYToXyz(0.5, 1e-8, 1);
    expect(x).toBe(0);
    expect(y).toBe(0);
    expect(z).toBe(0);
  });
});

describe('xyzToLinearRgb', () => {
  it('roundtrip XYZ → RGB → XYZ matches within tolerance', () => {
    const rgbToXyz = chromaticitiesToRgbXyzMatrix(CHROMATICITIES_REC709);
    const x0 = 0.5;
    const y0 = 0.5;
    const z0 = 0.5;
    const { r, g, b } = xyzToLinearRgb(x0, y0, z0, CHROMATICITIES_REC709);
    const xBack = rgbToXyz[0][0] * r + rgbToXyz[0][1] * g + rgbToXyz[0][2] * b;
    const yBack = rgbToXyz[1][0] * r + rgbToXyz[1][1] * g + rgbToXyz[1][2] * b;
    const zBack = rgbToXyz[2][0] * r + rgbToXyz[2][1] * g + rgbToXyz[2][2] * b;
    expect(xBack).toBeCloseTo(x0, 4);
    expect(yBack).toBeCloseTo(y0, 4);
    expect(zBack).toBeCloseTo(z0, 4);
  });

  it('Rec 2020 red primary xy → RGB ≈ (1,0,0)', () => {
    const { redX, redY } = CHROMATICITIES_REC2020;
    const { r, g, b } = xyToLinearRgb(redX, redY, CHROMATICITIES_REC2020);
    expect(r).toBeGreaterThan(0.99);
    expect(g).toBeLessThan(0.01);
    expect(b).toBeLessThan(0.01);
  });
});
