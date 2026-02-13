import { describe, expect, it } from 'vitest';
import { getToneMapping } from './mappers.js';
import type { ToneMappingBatchFn } from './types.js';

/** Invoke batch mapper with single pixel for testing. */
function invokeMapper(mapper: ToneMappingBatchFn, r: number, g: number, b: number): [number, number, number] {
  const input = new Float32Array([r, g, b]);
  const output = new Float32Array(3);
  mapper(input, output, 1);
  return [output[0] ?? 0, output[1] ?? 0, output[2] ?? 0];
}

describe('getToneMapping', () => {
  it('should return aces mapper for aces type', () => {
    const mapper = getToneMapping('aces');
    expect(typeof mapper).toBe('function');

    const [r, g, b] = invokeMapper(mapper, 1, 1, 1);
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

    const [r, g, b] = invokeMapper(mapper, 1, 1, 1);
    expect(r).toBeCloseTo(0.5); // 1 / (1 + 1)
    expect(g).toBeCloseTo(0.5);
    expect(b).toBeCloseTo(0.5);
  });

  it('reinhard should map x to x/(1+x)', () => {
    const mapper = getToneMapping('reinhard');
    const [r] = invokeMapper(mapper, 10, 0, 0);
    expect(r).toBeCloseTo(10 / 11);
  });

  it('should return neutral mapper for neutral type', () => {
    const mapper = getToneMapping('neutral');
    expect(typeof mapper).toBe('function');
    const [r, g, b] = invokeMapper(mapper, 1, 1, 1);
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
    const [r, g, b] = invokeMapper(mapper, 1, 1, 1);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });
});

describe('acesFilmic neutrality (low-level)', () => {
  const NEUTRAL_TOLERANCE = 1e-4;

  it('produces neutral output for (1,1,1)', () => {
    const mapper = getToneMapping('aces');
    const [r, g, b] = invokeMapper(mapper, 1, 1, 1);
    expect(Math.abs(r - g)).toBeLessThan(NEUTRAL_TOLERANCE);
    expect(Math.abs(g - b)).toBeLessThan(NEUTRAL_TOLERANCE);
    expect(Math.abs(r - b)).toBeLessThan(NEUTRAL_TOLERANCE);
  });

  it('produces neutral output for (10,10,10)', () => {
    const mapper = getToneMapping('aces');
    const [r, g, b] = invokeMapper(mapper, 10, 10, 10);
    expect(Math.abs(r - g)).toBeLessThan(NEUTRAL_TOLERANCE);
    expect(Math.abs(g - b)).toBeLessThan(NEUTRAL_TOLERANCE);
    expect(Math.abs(r - b)).toBeLessThan(NEUTRAL_TOLERANCE);
  });

  it('produces neutral output for (100,100,100)', () => {
    const mapper = getToneMapping('aces');
    const [r, g, b] = invokeMapper(mapper, 100, 100, 100);
    expect(Math.abs(r - g)).toBeLessThan(NEUTRAL_TOLERANCE);
    expect(Math.abs(g - b)).toBeLessThan(NEUTRAL_TOLERANCE);
  });

  it('yellow (1,1,0) does not shift toward orange: R and G remain similar', () => {
    const mapper = getToneMapping('aces');
    const [r, g, b] = invokeMapper(mapper, 1, 1, 0);
    expect(Math.abs(r - g)).toBeLessThan(0.05);
    expect(b).toBeLessThan(0.1);
  });
});

const HUE_NEUTRAL_TOLERANCE = 1e-2;
const HUE_NEUTRAL_TOLERANCE_AGX = 0.65;

function assertNeutral(
  mapper: ToneMappingBatchFn,
  rIn: number,
  gIn: number,
  bIn: number,
  tolerance: number = HUE_NEUTRAL_TOLERANCE,
): void {
  const [R, G, B] = invokeMapper(mapper, rIn, gIn, bIn);
  expect(Math.abs(R - G)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(G - B)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(R - B)).toBeLessThanOrEqual(tolerance);
}

describe('tone mapping hue preservation', () => {
  const neutralInputs: [number, number, number][] = [
    [1, 1, 1],
    [0.5, 0.5, 0.5],
    [2, 2, 2],
  ];

  describe('aces', () => {
    it.each(neutralInputs)('produces neutral output for (%s, %s, %s)', (rIn, gIn, bIn) => {
      assertNeutral(getToneMapping('aces'), rIn, gIn, bIn);
    });
  });

  describe('reinhard', () => {
    it.each(neutralInputs)('produces neutral output for (%s, %s, %s)', (rIn, gIn, bIn) => {
      assertNeutral(getToneMapping('reinhard'), rIn, gIn, bIn);
    });
  });

  describe('neutral', () => {
    it.each(neutralInputs)('produces neutral output for (%s, %s, %s)', (rIn, gIn, bIn) => {
      assertNeutral(getToneMapping('neutral'), rIn, gIn, bIn);
    });
  });

  describe('agx', () => {
    it.each(neutralInputs)('produces neutral output for (%s, %s, %s)', (rIn, gIn, bIn) => {
      assertNeutral(getToneMapping('agx'), rIn, gIn, bIn, HUE_NEUTRAL_TOLERANCE_AGX);
    });

    it('(1,1,1) does not produce strong hue shift', () => {
      const mapper = getToneMapping('agx');
      const [ro, go, bo] = invokeMapper(mapper, 1, 1, 1);
      const maxDiff = Math.max(Math.abs(ro - go), Math.abs(go - bo), Math.abs(ro - bo));
      expect(maxDiff).toBeLessThanOrEqual(HUE_NEUTRAL_TOLERANCE_AGX);
    });
  });
});
