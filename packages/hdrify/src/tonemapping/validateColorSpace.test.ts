import { describe, expect, it } from 'vitest';
import { CHROMATICITIES_REC709 } from '../color/chromaticities.js';
import type { FloatImageData } from '../floatImage.js';
import { validateToneMappingColorSpace, validateToneMappingColorSpaceFromMetadata } from './validateColorSpace.js';

function createImage(metadata?: Record<string, unknown>): FloatImageData {
  return {
    width: 1,
    height: 1,
    data: new Float32Array([1, 1, 1, 1]),
    linearColorSpace: 'linear-rec709' as const,
    metadata,
  };
}

describe('validateToneMappingColorSpace', () => {
  it('allows images without chromaticities', () => {
    const image = createImage();
    expect(() => validateToneMappingColorSpace(image)).not.toThrow();
  });

  it('allows images with Rec. 709 chromaticities', () => {
    const image = createImage({ chromaticities: CHROMATICITIES_REC709 });
    expect(() => validateToneMappingColorSpace(image)).not.toThrow();
  });

  it('throws for wide gamut chromaticities', () => {
    // DCI-P3 red primary (wider than Rec. 709)
    const wideGamut = {
      redX: 0.68,
      redY: 0.32,
      greenX: 0.265,
      greenY: 0.69,
      blueX: 0.15,
      blueY: 0.06,
      whiteX: 0.3127,
      whiteY: 0.329,
    };
    const image = createImage({ chromaticities: wideGamut });
    expect(() => validateToneMappingColorSpace(image)).toThrow(/Rec\. 709|chromaticities|wide color space/i);
    expect(() => validateToneMappingColorSpace(image)).toThrow(/Rec\. 709/);
  });

  it('allows when chromaticities are absent in metadata', () => {
    const image = createImage({ otherKey: 'value' });
    expect(() => validateToneMappingColorSpace(image)).not.toThrow();
  });
});

describe('validateToneMappingColorSpaceFromMetadata', () => {
  it('allows undefined metadata', () => {
    expect(() => validateToneMappingColorSpaceFromMetadata(undefined)).not.toThrow();
  });

  it('allows metadata without chromaticities', () => {
    expect(() => validateToneMappingColorSpaceFromMetadata({})).not.toThrow();
  });

  it('allows Rec. 709 chromaticities', () => {
    expect(() => validateToneMappingColorSpaceFromMetadata({ chromaticities: CHROMATICITIES_REC709 })).not.toThrow();
  });

  it('throws for non-Rec. 709 chromaticities', () => {
    const wideGamut = {
      redX: 0.68,
      redY: 0.32,
      greenX: 0.265,
      greenY: 0.69,
      blueX: 0.15,
      blueY: 0.06,
      whiteX: 0.3127,
      whiteY: 0.329,
    };
    expect(() => validateToneMappingColorSpaceFromMetadata({ chromaticities: wideGamut })).toThrow(/Rec\. 709/);
  });
});
