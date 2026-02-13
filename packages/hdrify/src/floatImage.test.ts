import { describe, expect, it } from 'vitest';
import { ensureNonNegativeFinite } from './floatImage.js';

describe('ensureNonNegativeFinite', () => {
  it('leaves positive finite values unchanged', () => {
    const data = new Float32Array([0, 0.5, 1, 100]);
    ensureNonNegativeFinite(data);
    expect([...data]).toEqual([0, 0.5, 1, 100]);
  });

  it('replaces NaN with 0', () => {
    const data = new Float32Array([1, Number.NaN, 2]);
    ensureNonNegativeFinite(data);
    expect(data[0]).toBe(1);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(2);
  });

  it('replaces positive Infinity with 0', () => {
    const data = new Float32Array([1, Number.POSITIVE_INFINITY, 2]);
    ensureNonNegativeFinite(data);
    expect(data[0]).toBe(1);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(2);
  });

  it('replaces negative Infinity with 0', () => {
    const data = new Float32Array([1, Number.NEGATIVE_INFINITY, 2]);
    ensureNonNegativeFinite(data);
    expect(data[0]).toBe(1);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(2);
  });

  it('replaces negative values with 0', () => {
    const data = new Float32Array([0, -0.1, -1, -100]);
    ensureNonNegativeFinite(data);
    expect([...data]).toEqual([0, 0, 0, 0]);
  });

  it('mutates array in place (mixed invalid values)', () => {
    const data = new Float32Array([0.5, Number.NaN, -1, Number.POSITIVE_INFINITY, 2, Number.NEGATIVE_INFINITY]);
    ensureNonNegativeFinite(data);
    expect([...data]).toEqual([0.5, 0, 0, 0, 2, 0]);
  });

  it('handles empty array', () => {
    const data = new Float32Array(0);
    ensureNonNegativeFinite(data);
    expect(data.length).toBe(0);
  });
});
