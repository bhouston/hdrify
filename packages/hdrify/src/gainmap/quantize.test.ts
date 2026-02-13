import { describe, expect, it } from 'vitest';
import { dequantizeU8ToFloat, dequantizeU8ToRgbaFloat, quantizeFloatToU8, quantizeRgbaFloatToU8 } from './quantize.js';

describe('quantizeFloatToU8', () => {
  it('maps 0 to 0', () => {
    expect(quantizeFloatToU8(0)).toBe(0);
  });
  it('maps 1 to 255', () => {
    expect(quantizeFloatToU8(1)).toBe(255);
  });
  it('rounds 0.5 to 128', () => {
    expect(quantizeFloatToU8(0.5)).toBe(128);
  });
  it('clamps values outside [0,1]', () => {
    expect(quantizeFloatToU8(-0.1)).toBe(0);
    expect(quantizeFloatToU8(1.1)).toBe(255);
  });
});

describe('dequantizeU8ToFloat', () => {
  it('maps 0 to 0', () => {
    expect(dequantizeU8ToFloat(0)).toBe(0);
  });
  it('maps 255 to 1', () => {
    expect(dequantizeU8ToFloat(255)).toBe(1);
  });
  it('maps 128 to 128/255', () => {
    expect(dequantizeU8ToFloat(128)).toBe(128 / 255);
  });
});

describe('round-trip quantize then dequantize', () => {
  it('max error is 0.5/255 for any float in [0,1]', () => {
    const maxError = 0.5 / 255;
    for (let i = 0; i <= 255; i++) {
      const x = i / 255;
      const b = quantizeFloatToU8(x);
      const back = dequantizeU8ToFloat(b);
      expect(Math.abs(back - x)).toBeLessThanOrEqual(maxError + 1e-10);
    }
  });
  it('round-trip for 100 random values in [0,1]', () => {
    const maxError = 0.5 / 255;
    for (let k = 0; k < 100; k++) {
      const x = Math.random();
      const back = dequantizeU8ToFloat(quantizeFloatToU8(x));
      expect(Math.abs(back - x)).toBeLessThanOrEqual(maxError + 1e-10);
    }
  });
});

describe('quantizeRgbaFloatToU8 / dequantizeU8ToRgbaFloat', () => {
  it('round-trips and max per-channel error is 0.5/255', () => {
    const rgba = new Float32Array([0, 0.5, 1, 0.3, 0.001, 0.999, 0.4, 1]);
    const u8 = quantizeRgbaFloatToU8(rgba);
    const back = dequantizeU8ToRgbaFloat(u8);
    const maxError = 0.5 / 255;
    for (let i = 0; i < rgba.length; i++) {
      const err = Math.abs((back[i] ?? 0) - (rgba[i] ?? 0));
      expect(err).toBeLessThanOrEqual(maxError + 2e-6);
    }
  });
});
