import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeGainMap, readExr } from 'hdrify';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../../..');
const assetsDir = path.join(workspaceRoot, 'assets');
const exampleWideColorSpacePath = path.join(assetsDir, 'example_wideColorSpace.exr');

/** Wide gamut chromaticities (e.g. DCI-P3) - example_wideColorSpace.exr has colors outside Rec. 709 */
const WIDE_GAMUT_CHROMATICITIES = {
  redX: 0.68,
  redY: 0.32,
  greenX: 0.265,
  greenY: 0.69,
  blueX: 0.15,
  blueY: 0.06,
  whiteX: 0.3127,
  whiteY: 0.329,
};

describe('color space validation with example_wideColorSpace.exr', () => {
  it('rejects example_wideColorSpace.exr because chromaticities do not match Rec. 709 and tone mapping assumes Rec. 709 / sRGB primaries', () => {
    if (!fs.existsSync(exampleWideColorSpacePath)) {
      throw new Error(
        `Test asset not found: ${exampleWideColorSpacePath}. Copy WideColorGamut.exr from openexr-images to assets/example_wideColorSpace.exr`,
      );
    }

    const buffer = fs.readFileSync(exampleWideColorSpacePath);
    const exrBuffer = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const imageData = readExr(exrBuffer);

    // example_wideColorSpace.exr may not have chromaticities in header; inject wide gamut
    // to validate we reject images with non-Rec. 709 color space
    const imageWithWideGamutMetadata = {
      ...imageData,
      metadata: { ...imageData.metadata, chromaticities: WIDE_GAMUT_CHROMATICITIES },
    };

    expect(() => encodeGainMap(imageWithWideGamutMetadata)).toThrow(/Rec\. 709|chromaticities|wide color space/i);
  });
});
