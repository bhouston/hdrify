import { describe, expect, it } from 'vitest';
import { getToneMapping } from './mappers.js';
import type { ToneMappingType } from './types.js';

describe('getToneMapping', () => {
  it('should return aces mapper for aces type', () => {
    const mapper = getToneMapping('aces');
    expect(typeof mapper).toBe('function');

    const [r, g, b] = mapper(1, 1, 1);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });

  it('should return reinhard mapper for reinhard type', () => {
    const mapper = getToneMapping('reinhard');
    expect(typeof mapper).toBe('function');

    const [r, g, b] = mapper(1, 1, 1);
    expect(r).toBeCloseTo(0.5); // 1 / (1 + 1)
    expect(g).toBeCloseTo(0.5);
    expect(b).toBeCloseTo(0.5);
  });

  it('should return aces mapper for unknown type (default branch)', () => {
    const mapper = getToneMapping('unknown' as ToneMappingType);
    expect(typeof mapper).toBe('function');

    const [r, g, b] = mapper(1, 1, 1);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    // Default returns acesFilmic, which produces same output as aces
    const acesMapper = getToneMapping('aces');
    const acesResult = acesMapper(1, 1, 1);
    expect(r).toBeCloseTo(acesResult[0]);
    expect(g).toBeCloseTo(acesResult[1]);
    expect(b).toBeCloseTo(acesResult[2]);
  });

  it('reinhard should map x to x/(1+x)', () => {
    const mapper = getToneMapping('reinhard');
    const [r] = mapper(10, 0, 0);
    expect(r).toBeCloseTo(10 / 11);
  });

  it('should return neutral mapper for neutral type', () => {
    const mapper = getToneMapping('neutral');
    expect(typeof mapper).toBe('function');
    const [r, g, b] = mapper(1, 1, 1);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });

  it('should return agx mapper for agx type', () => {
    const mapper = getToneMapping('agx');
    expect(typeof mapper).toBe('function');
    const [r, g, b] = mapper(1, 1, 1);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });
});

describe('acesFilmic neutrality (low-level)', () => {
  /** ACES preserves neutral input: (1,1,1) and (10,10,10) must produce R≈G≈B output */
  const NEUTRAL_TOLERANCE = 1e-4;

  it('produces neutral output for (1,1,1)', () => {
    const mapper = getToneMapping('aces');
    const [r, g, b] = mapper(1, 1, 1);
    expect(Math.abs(r - g)).toBeLessThan(NEUTRAL_TOLERANCE);
    expect(Math.abs(g - b)).toBeLessThan(NEUTRAL_TOLERANCE);
    expect(Math.abs(r - b)).toBeLessThan(NEUTRAL_TOLERANCE);
  });

  it('produces neutral output for (10,10,10)', () => {
    const mapper = getToneMapping('aces');
    const [r, g, b] = mapper(10, 10, 10);
    expect(Math.abs(r - g)).toBeLessThan(NEUTRAL_TOLERANCE);
    expect(Math.abs(g - b)).toBeLessThan(NEUTRAL_TOLERANCE);
    expect(Math.abs(r - b)).toBeLessThan(NEUTRAL_TOLERANCE);
  });

  it('produces neutral output for (100,100,100)', () => {
    const mapper = getToneMapping('aces');
    const [r, g, b] = mapper(100, 100, 100);
    expect(Math.abs(r - g)).toBeLessThan(NEUTRAL_TOLERANCE);
    expect(Math.abs(g - b)).toBeLessThan(NEUTRAL_TOLERANCE);
  });

  it('yellow (1,1,0) does not shift toward orange: R and G remain similar', () => {
    const mapper = getToneMapping('aces');
    const [r, g, b] = mapper(1, 1, 0);
    // Input has R=G, so output should have R≈G (yellow), not R>>G (orange)
    expect(Math.abs(r - g)).toBeLessThan(0.05);
    expect(b).toBeLessThan(0.1);
  });
});
