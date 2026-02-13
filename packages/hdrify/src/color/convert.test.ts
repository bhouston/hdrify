import { describe, expect, it } from 'vitest';
import { createGradientImage } from '../synthetic/createGradientImage.js';
import { convertFloat32ToLinearColorSpace, convertLinearColorSpace } from './convert.js';

describe('convertFloat32ToLinearColorSpace', () => {
  it('returns original data when from === to', () => {
    const data = new Float32Array([1, 0.5, 0, 1]);
    const result = convertFloat32ToLinearColorSpace(data, 1, 1, 'linear-rec709', 'linear-rec709');
    expect(result).toBe(data);
  });

  it('returns new array when conversion needed', () => {
    const data = new Float32Array([1, 0.5, 0, 1]);
    const result = convertFloat32ToLinearColorSpace(data, 1, 1, 'linear-rec709', 'linear-p3');
    expect(result).not.toBe(data);
    expect(result.length).toBe(data.length);
    expect(result[0]).toBeDefined();
  });

  it('converts between linear-rec709 and linear-p3', () => {
    const img = createGradientImage({
      width: 2,
      height: 2,
      mode: 'horizontal',
      min: 0,
      max: 1,
    });
    const converted = convertFloat32ToLinearColorSpace(img.data, img.width, img.height, 'linear-rec709', 'linear-p3');
    expect(converted.length).toBe(img.data.length);
    // White (1,1,1) should stay white after conversion
    const lastPixel = (img.width * img.height - 1) * 4;
    expect(converted[lastPixel]).toBeCloseTo(1, 2);
    expect(converted[lastPixel + 1]).toBeCloseTo(1, 2);
    expect(converted[lastPixel + 2]).toBeCloseTo(1, 2);
  });
});

describe('convertLinearColorSpace', () => {
  it('returns new image with converted data', () => {
    const img = createGradientImage({
      width: 4,
      height: 4,
      mode: 'horizontal',
      min: 0,
      max: 1,
    });
    const converted = convertLinearColorSpace(img, 'linear-p3');
    expect(converted.linearColorSpace).toBe('linear-p3');
    expect(converted.width).toBe(img.width);
    expect(converted.height).toBe(img.height);
    expect(converted.data).not.toBe(img.data);
  });

  it('returns same image when already in target space', () => {
    const img = createGradientImage({
      width: 2,
      height: 2,
      mode: 'horizontal',
      min: 0,
      max: 1,
    });
    const converted = convertLinearColorSpace(img, 'linear-rec709');
    expect(converted.linearColorSpace).toBe('linear-rec709');
    expect(converted.data).toBe(img.data);
  });
});
