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

describe('color space handling with example_wideColorSpace.exr', () => {
  it('accepts wide gamut EXR and converts to linear-rec709 before encoding (no throw)', () => {
    if (!fs.existsSync(exampleWideColorSpacePath)) {
      throw new Error(
        `Test asset not found: ${exampleWideColorSpacePath}. Copy WideColorGamut.exr from openexr-images to assets/example_wideColorSpace.exr`,
      );
    }

    const buffer = fs.readFileSync(exampleWideColorSpacePath);
    const exrBuffer = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const imageData = readExr(exrBuffer);

    // Wide gamut image: encodeGainMap converts to linear-rec709 internally, no throw
    const imageWithWideGamut = {
      ...imageData,
      linearColorSpace: 'linear-p3' as const,
      metadata: { ...imageData.metadata, chromaticities: WIDE_GAMUT_CHROMATICITIES },
    };

    const result = encodeGainMap(imageWithWideGamut);
    expect(result.sdr).toBeDefined();
    expect(result.gainMap).toBeDefined();
    expect(result.width).toBe(imageData.width);
    expect(result.height).toBe(imageData.height);
  });
});
