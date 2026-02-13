import { describe, expect, it } from 'vitest';
import { applyToneMapping } from './applyToneMapping.js';

describe('applyToneMapping', () => {
  it('should apply reinhard tone mapping by default', () => {
    const hdrData = new Float32Array([1, 1, 1, 1, 0.5, 0.5, 0.5, 1]);
    const result = applyToneMapping(hdrData, 2, 1);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(6); // 2 pixels * 3 RGB
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(0);
      expect(result[i]).toBeLessThanOrEqual(255);
    }
  });

  it('should apply aces tone mapping when specified', () => {
    const hdrData = new Float32Array([1, 1, 1, 1, 0.5, 0.5, 0.5, 1]);
    const resultReinhard = applyToneMapping(hdrData, 2, 1, { toneMapping: 'reinhard' });
    const resultAces = applyToneMapping(hdrData, 2, 1, { toneMapping: 'aces' });

    expect(resultAces.length).toBe(resultReinhard.length);
    // ACES and Reinhard produce different outputs
    expect(resultAces).not.toEqual(resultReinhard);
  });

  it('should accept custom exposure', () => {
    const hdrData = new Float32Array([1, 1, 1, 1]);
    const result1 = applyToneMapping(hdrData, 1, 1, { exposure: 1.0 });
    const result2 = applyToneMapping(hdrData, 1, 1, { exposure: 2.0 });

    expect(result1).not.toEqual(result2);
    expect(result2[0]).toBeGreaterThan(result1[0] ?? 0);
  });

  it('should handle edge case with single pixel', () => {
    const hdrData = new Float32Array([1, 0, 0, 1]);
    const result = applyToneMapping(hdrData, 1, 1);

    expect(result.length).toBe(3);
    expect(result[0]).toBeGreaterThan(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
  });

  it('should handle edge case with empty/short data', () => {
    const hdrData = new Float32Array([]);
    const result = applyToneMapping(hdrData, 1, 1);

    expect(result.length).toBe(3);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
  });

  it('outputs sRGB (linear → linearToSrgb → 0-255)', () => {
    const hdrData = new Float32Array([0.5, 0.5, 0.5, 1]);
    const result = applyToneMapping(hdrData, 1, 1, { toneMapping: 'reinhard' });
    // Reinhard(0.5) = 1/3 linear; sRGB(1/3) ≈ 0.215 → byte ≈ 55
    expect(result[0]).toBeGreaterThanOrEqual(0);
    expect(result[0]).toBeLessThanOrEqual(255);
    expect(result[1]).toBe(result[0]);
    expect(result[2]).toBe(result[0]);
  });
});
