import { describe, expect, it } from 'vitest';
import { encodeGainMap } from './gainMapEncoder.js';

describe('encodeGainMap', () => {
  const smallImage = {
    width: 2,
    height: 2,
    data: new Float32Array([2, 2, 2, 1, 1, 1, 1, 1, 0.5, 0.5, 0.5, 1, 0.25, 0.25, 0.25, 1]),
  };

  it('should accept minContentBoost option', () => {
    const result = encodeGainMap(smallImage, { minContentBoost: 2 });

    expect(result.metadata.gainMapMin[0]).toBeCloseTo(Math.log2(2));
    expect(result.metadata.gainMapMin[1]).toBeCloseTo(Math.log2(2));
    expect(result.metadata.gainMapMin[2]).toBeCloseTo(Math.log2(2));
  });

  it('should accept custom offsetSdr and offsetHdr', () => {
    const customOffset = [0.02, 0.02, 0.02] as [number, number, number];
    const result = encodeGainMap(smallImage, {
      offsetSdr: customOffset,
      offsetHdr: customOffset,
    });

    expect(result.metadata.offsetSdr).toEqual(customOffset);
    expect(result.metadata.offsetHdr).toEqual(customOffset);
  });

  it('should accept custom gamma', () => {
    const customGamma = [1.5, 1.5, 1.5] as [number, number, number];
    const result = encodeGainMap(smallImage, { gamma: customGamma });

    expect(result.metadata.gamma).toEqual(customGamma);
  });

  it('should accept exposure option', () => {
    const resultDefault = encodeGainMap(smallImage);
    const resultExposure2 = encodeGainMap(smallImage, { exposure: 2 });

    expect(resultExposure2.sdr).not.toEqual(resultDefault.sdr);
  });

  it('should use maxContentBoost when provided as option', () => {
    const result = encodeGainMap(smallImage, { maxContentBoost: 16 });

    expect(result.metadata.gainMapMax[0]).toBeCloseTo(Math.log2(16));
    expect(result.metadata.gainMapMax[1]).toBeCloseTo(Math.log2(16));
    expect(result.metadata.gainMapMax[2]).toBeCloseTo(Math.log2(16));
  });

  it('should handle image with very low values', () => {
    const lowImage = {
      width: 1,
      height: 1,
      data: new Float32Array([0.001, 0.001, 0.001, 1]),
    };
    const result = encodeGainMap(lowImage);

    expect(result.sdr.length).toBe(4);
    expect(result.gainMap.length).toBe(4);
    expect(result.metadata.hdrCapacityMax).toBeGreaterThan(result.metadata.hdrCapacityMin);
  });
});
