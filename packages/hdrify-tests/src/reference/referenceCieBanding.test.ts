/**
 * Unit test to detect banding in CLI reference images.
 *
 * The reference_cie.hdr image (generated via `hdrify reference --type cie-wedge`) exhibits
 * extreme banding due to Radiance RGBE format limitations. This test loads the gradient
 * from EXR (high precision) and compares it with the internally-generated reference image,
 * then verifies we can identify that the HDR version has >1% difference (banding).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareFloatImages,
  createCieColorWedgeImage,
  convertLinearColorSpace,
  readExr,
  readHdr,
} from 'hdrify';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../../..');
const assetsDir = path.join(workspaceRoot, 'assets');

const refCieExr = path.join(assetsDir, 'reference_cie.exr');
const refCieHdr = path.join(assetsDir, 'reference_cie.hdr');

function toUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const TOLERANCE_1_PCT = {
  tolerancePercent: 0.01,
  toleranceAbsolute: 0.01, // for small values
};

describe('reference_cie banding detection', () => {
  it('EXR loads and matches generated reference within 1%', () => {
    const fromExr = readExr(toUint8Array(fs.readFileSync(refCieExr)));
    const generated = createCieColorWedgeImage({ width: fromExr.width, height: fromExr.height });

    const result = compareFloatImages(generated, fromExr, TOLERANCE_1_PCT);
    expect(
      result.match,
      `EXR should match generated: maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });

  it('HDR matches generated reference within 1% (fails if banding)', () => {
    const fromHdr = readHdr(toUint8Array(fs.readFileSync(refCieHdr)));
    const generated = createCieColorWedgeImage({ width: fromHdr.width, height: fromHdr.height });
    // CLI converts cie-wedge to linear-rec709 before writing HDR
    const expected = convertLinearColorSpace(generated, 'linear-rec709');

    const result = compareFloatImages(expected, fromHdr, TOLERANCE_1_PCT);
    expect(
      result.match,
      `HDR has banding: differs from reference by >1%. maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });
});
