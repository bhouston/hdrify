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
});
