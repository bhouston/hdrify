import { describe, expect, it } from 'vitest';
import type { FloatImageData } from './floatImage.js';
import { addRangeMetadata } from './rangeMetadata.js';

describe('addRangeMetadata', () => {
  it('computes correct MIN_VALUE, MAX_VALUE, RANGE, AVG_VALUE for known 2x2 image', () => {
    const image: FloatImageData = {
      width: 2,
      height: 2,
      data: new Float32Array([
        1.0,
        0.0,
        0.0,
        1.0, // R=1, G=0, B=0
        0.0,
        1.0,
        0.0,
        1.0, // R=0, G=1, B=0
        0.0,
        0.0,
        1.0,
        1.0, // R=0, G=0, B=1
        0.5,
        0.5,
        0.5,
        1.0, // R=0.5, G=0.5, B=0.5
      ]),
    };

    const result = addRangeMetadata(image);

    expect(result.MIN_VALUE).toEqual([0, 0, 0]);
    expect(result.MAX_VALUE).toEqual([1, 1, 1]);
    expect(result.RANGE).toEqual([1, 1, 1]);
    expect(result.AVG_VALUE).toEqual([0.375, 0.375, 0.375]);
  });

  it('single pixel: min equals max, range is [0,0,0], avg equals min/max', () => {
    const image: FloatImageData = {
      width: 1,
      height: 1,
      data: new Float32Array([2.5, 0.3, 1.7, 1.0]),
    };

    const result = addRangeMetadata(image);

    expect(result.MIN_VALUE).toEqual([2.5, 0.3, 1.7]);
    expect(result.MAX_VALUE).toEqual([2.5, 0.3, 1.7]);
    expect(result.RANGE).toEqual([0, 0, 0]);
    expect(result.AVG_VALUE).toEqual([2.5, 0.3, 1.7]);
  });

  it('uniform image: RANGE is [0,0,0], AVG equals MIN/MAX', () => {
    const image: FloatImageData = {
      width: 3,
      height: 2,
      data: new Float32Array(3 * 2 * 4).fill(0.5),
    };

    const result = addRangeMetadata(image);

    expect(result.MIN_VALUE).toEqual([0.5, 0.5, 0.5]);
    expect(result.MAX_VALUE).toEqual([0.5, 0.5, 0.5]);
    expect(result.RANGE).toEqual([0, 0, 0]);
    expect(result.AVG_VALUE).toEqual([0.5, 0.5, 0.5]);
  });

  it('empty image returns zeros for all arrays', () => {
    const image: FloatImageData = {
      width: 0,
      height: 0,
      data: new Float32Array(0),
    };

    const result = addRangeMetadata(image);

    expect(result.MIN_VALUE).toEqual([0, 0, 0]);
    expect(result.MAX_VALUE).toEqual([0, 0, 0]);
    expect(result.RANGE).toEqual([0, 0, 0]);
    expect(result.AVG_VALUE).toEqual([0, 0, 0]);
  });
});
