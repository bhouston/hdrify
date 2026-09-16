import { describe, expect, it } from 'vitest';
import { flipImage } from './flip.js';
import type { HdrifyImage } from './hdrifyImage.js';

/** 2x2 image, R channel = row-major pixel index (0,1,2,3), so flips are easy to read off. */
function makeIndexedImage(): HdrifyImage {
  const data = new Float32Array(2 * 2 * 4);
  for (let i = 0; i < 4; i++) data[i * 4] = i;
  return { width: 2, height: 2, data, linearColorSpace: 'linear-rec709' };
}

const rValues = (image: HdrifyImage): number[] =>
  Array.from({ length: image.width * image.height }, (_, i) => image.data[i * 4]!);

describe('flipImage', () => {
  it('defaults to a no-op copy (new buffer, same values)', () => {
    const image = makeIndexedImage();
    const flipped = flipImage(image);
    expect(flipped.data).not.toBe(image.data);
    expect(rValues(flipped)).toEqual([0, 1, 2, 3]);
  });

  it('{ y: -1 } mirrors top-to-bottom, keeping row order within each row', () => {
    const flipped = flipImage(makeIndexedImage(), { y: -1 });
    // row0=[0,1], row1=[2,3] -> row0=[2,3], row1=[0,1]
    expect(rValues(flipped)).toEqual([2, 3, 0, 1]);
  });

  it('{ x: -1 } mirrors left-to-right, keeping row order', () => {
    const flipped = flipImage(makeIndexedImage(), { x: -1 });
    // row0=[0,1]->[1,0], row1=[2,3]->[3,2]
    expect(rValues(flipped)).toEqual([1, 0, 3, 2]);
  });

  it('{ x: -1, y: -1 } flips both axes (180deg rotation)', () => {
    const flipped = flipImage(makeIndexedImage(), { x: -1, y: -1 });
    expect(rValues(flipped)).toEqual([3, 2, 1, 0]);
  });

  it('flipping twice on the same axis returns the original', () => {
    const image = makeIndexedImage();
    const roundTripped = flipImage(flipImage(image, { y: -1 }), { y: -1 });
    expect(rValues(roundTripped)).toEqual(rValues(image));
  });

  it('preserves width, height, linearColorSpace and metadata', () => {
    const image: HdrifyImage = { ...makeIndexedImage(), metadata: { compression: 4 } };
    const flipped = flipImage(image, { x: -1, y: -1 });
    expect(flipped.width).toBe(image.width);
    expect(flipped.height).toBe(image.height);
    expect(flipped.linearColorSpace).toBe(image.linearColorSpace);
    expect(flipped.metadata).toBe(image.metadata);
  });

  it('rejects values other than 1 or -1', () => {
    const image = makeIndexedImage();
    // @ts-expect-error testing runtime validation of an invalid option
    expect(() => flipImage(image, { x: 2 })).toThrow(/x must be 1 or -1/);
    // @ts-expect-error testing runtime validation of an invalid option
    expect(() => flipImage(image, { y: 0 })).toThrow(/y must be 1 or -1/);
  });
});
