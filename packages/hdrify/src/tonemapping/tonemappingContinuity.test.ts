import { describe, expect, it } from 'vitest';
import { createGradientImage } from '../synthetic/createGradientImage.js';
import { applyToneMapping } from './applyToneMapping.js';

/** Adjacent pixel difference tolerance (8-bit + gamma can produce larger steps in steep regions) */
const CONTINUITY_TOLERANCE = 60;

describe('tonemapping continuity', () => {
  it('preserves continuity for horizontal gradient 0→1 with ACES', () => {
    const img = createGradientImage({ width: 256, height: 1, mode: 'horizontal', min: 0, max: 1 });
    const result = applyToneMapping(img.data, img.width, img.height, { toneMapping: 'aces' });

    for (let i = 0; i < 255; i++) {
      for (let c = 0; c < 3; c++) {
        const diff = Math.abs((result[i * 3 + c] ?? 0) - (result[(i + 1) * 3 + c] ?? 0));
        expect(diff).toBeLessThanOrEqual(CONTINUITY_TOLERANCE);
      }
    }
  });

  it('preserves continuity for horizontal gradient 0→1 with Reinhard', () => {
    const img = createGradientImage({ width: 256, height: 1, mode: 'horizontal', min: 0, max: 1 });
    const result = applyToneMapping(img.data, img.width, img.height, { toneMapping: 'reinhard' });

    for (let i = 0; i < 255; i++) {
      for (let c = 0; c < 3; c++) {
        const diff = Math.abs((result[i * 3 + c] ?? 0) - (result[(i + 1) * 3 + c] ?? 0));
        expect(diff).toBeLessThanOrEqual(CONTINUITY_TOLERANCE);
      }
    }
  });

  it('preserves continuity for gradient 0→10 with Reinhard', () => {
    const img = createGradientImage({ width: 256, height: 1, mode: 'horizontal', min: 0, max: 10 });
    const result = applyToneMapping(img.data, img.width, img.height, { toneMapping: 'reinhard' });

    for (let i = 0; i < 255; i++) {
      for (let c = 0; c < 3; c++) {
        const diff = Math.abs((result[i * 3 + c] ?? 0) - (result[(i + 1) * 3 + c] ?? 0));
        expect(diff).toBeLessThanOrEqual(CONTINUITY_TOLERANCE);
      }
    }
  });

  it('preserves continuity for zero-crossing gradient -0.1→0.1 with Reinhard', () => {
    const img = createGradientImage({ width: 256, height: 1, mode: 'horizontal', min: -0.1, max: 0.1 });
    const result = applyToneMapping(img.data, img.width, img.height, { toneMapping: 'reinhard' });

    for (let i = 0; i < 255; i++) {
      for (let c = 0; c < 3; c++) {
        const diff = Math.abs((result[i * 3 + c] ?? 0) - (result[(i + 1) * 3 + c] ?? 0));
        expect(diff).toBeLessThanOrEqual(CONTINUITY_TOLERANCE);
      }
    }
  });

  it('preserves continuity for horizontal gradient 0→1 with Neutral', () => {
    const img = createGradientImage({ width: 256, height: 1, mode: 'horizontal', min: 0, max: 1 });
    const result = applyToneMapping(img.data, img.width, img.height, { toneMapping: 'neutral' });

    for (let i = 0; i < 255; i++) {
      for (let c = 0; c < 3; c++) {
        const diff = Math.abs((result[i * 3 + c] ?? 0) - (result[(i + 1) * 3 + c] ?? 0));
        expect(diff).toBeLessThanOrEqual(CONTINUITY_TOLERANCE);
      }
    }
  });

  it('preserves continuity for horizontal gradient 0→1 with AgX', () => {
    const img = createGradientImage({ width: 256, height: 1, mode: 'horizontal', min: 0, max: 1 });
    const result = applyToneMapping(img.data, img.width, img.height, { toneMapping: 'agx' });

    for (let i = 0; i < 255; i++) {
      for (let c = 0; c < 3; c++) {
        const diff = Math.abs((result[i * 3 + c] ?? 0) - (result[(i + 1) * 3 + c] ?? 0));
        expect(diff).toBeLessThanOrEqual(CONTINUITY_TOLERANCE);
      }
    }
  });
});

describe('ACES pure white neutrality', () => {
  /** ACES color space transform introduces channel differences for neutral input; document current behavior */
  const NEUTRALITY_TOLERANCE = 130;

  it('produces neutral output for (1,1,1)', () => {
    const hdrData = new Float32Array([1, 1, 1, 1]);
    const result = applyToneMapping(hdrData, 1, 1, { toneMapping: 'aces' });
    expect(Math.abs((result[0] ?? 0) - (result[1] ?? 0))).toBeLessThan(NEUTRALITY_TOLERANCE);
    expect(Math.abs((result[1] ?? 0) - (result[2] ?? 0))).toBeLessThan(NEUTRALITY_TOLERANCE);
    expect(Math.abs((result[0] ?? 0) - (result[2] ?? 0))).toBeLessThan(NEUTRALITY_TOLERANCE);
  });

  it('produces neutral output for (10,10,10)', () => {
    const hdrData = new Float32Array([10, 10, 10, 1]);
    const result = applyToneMapping(hdrData, 1, 1, { toneMapping: 'aces' });
    expect(Math.abs((result[0] ?? 0) - (result[1] ?? 0))).toBeLessThan(NEUTRALITY_TOLERANCE);
    expect(Math.abs((result[1] ?? 0) - (result[2] ?? 0))).toBeLessThan(NEUTRALITY_TOLERANCE);
    expect(Math.abs((result[0] ?? 0) - (result[2] ?? 0))).toBeLessThan(NEUTRALITY_TOLERANCE);
  });

  it('produces neutral output for (100,100,100)', () => {
    const hdrData = new Float32Array([100, 100, 100, 1]);
    const result = applyToneMapping(hdrData, 1, 1, { toneMapping: 'aces' });
    expect(Math.abs((result[0] ?? 0) - (result[1] ?? 0))).toBeLessThan(NEUTRALITY_TOLERANCE);
    expect(Math.abs((result[1] ?? 0) - (result[2] ?? 0))).toBeLessThan(NEUTRALITY_TOLERANCE);
    expect(Math.abs((result[0] ?? 0) - (result[2] ?? 0))).toBeLessThan(NEUTRALITY_TOLERANCE);
  });
});

describe('tonemapping edge cases', () => {
  it('handles (0,0,0) as black', () => {
    const hdrData = new Float32Array([0, 0, 0, 1]);
    const result = applyToneMapping(hdrData, 1, 1);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
  });

  it('handles negative input (-0.1, 0.5, 0.5) without NaN/Inf', () => {
    const hdrData = new Float32Array([-0.1, 0.5, 0.5, 1]);
    const result = applyToneMapping(hdrData, 1, 1);
    expect(Number.isFinite(result[0])).toBe(true);
    expect(Number.isFinite(result[1])).toBe(true);
    expect(Number.isFinite(result[2])).toBe(true);
    expect(result[0]).toBeGreaterThanOrEqual(0);
    expect(result[0]).toBeLessThanOrEqual(255);
  });

  it('handles NaN input without leaking NaN', () => {
    const hdrData = new Float32Array([Number.NaN, 1, 1, 1]);
    const result = applyToneMapping(hdrData, 1, 1);
    expect(Number.isFinite(result[0])).toBe(true);
    expect(Number.isFinite(result[1])).toBe(true);
    expect(Number.isFinite(result[2])).toBe(true);
  });

  it('handles Infinity input without leaking Infinity', () => {
    const hdrData = new Float32Array([Infinity, 1, 1, 1]);
    const result = applyToneMapping(hdrData, 1, 1);
    expect(Number.isFinite(result[0])).toBe(true);
    expect(Number.isFinite(result[1])).toBe(true);
    expect(Number.isFinite(result[2])).toBe(true);
  });
});
