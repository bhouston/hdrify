import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  compareFloatImages,
  createHsvRainbowImage,
  readExr,
  readHdr,
  writeExr,
  writeHdr,
} from 'hdrify';
import type { FloatImageData } from 'hdrify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const W = 16;
const H = 16;
const VALUE = 1;
const INTENSITY = 1;

const TOLERANCE = { tolerancePercent: 0.01 };

describe('conversion round-trip', () => {
  let original: FloatImageData;
  let tempDir: string;

  beforeAll(() => {
    tempDir = path.join(os.tmpdir(), `hdrify-roundtrip-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    original = createHsvRainbowImage({ width: W, height: H, value: VALUE, intensity: INTENSITY });
    fs.writeFileSync(path.join(tempDir, 'test.exr'), writeExr(original));
    fs.writeFileSync(path.join(tempDir, 'test.hdr'), writeHdr(original));
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('EXR round-trip: writeExr -> readExr matches original', () => {
    const buffer = writeExr(original);
    const parsed = readExr(buffer);
    const result = compareFloatImages(original, parsed, TOLERANCE);
    expect(result.match, `EXR round-trip failed: maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`).toBe(true);
  });

  it('HDR round-trip: writeHdr -> readHdr matches original', () => {
    const buffer = writeHdr(original);
    const parsed = readHdr(buffer);
    const result = compareFloatImages(original, parsed, TOLERANCE);
    expect(result.match, `HDR round-trip failed: maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`).toBe(true);
  });

  it('EXR -> HDR -> EXR: intermediate HDR matches writeHdr(original)', () => {
    const exrBuffer = writeExr(original);
    const fromExr = readExr(exrBuffer);
    const hdrBuffer = writeHdr(fromExr);
    const fromHdr = readHdr(hdrBuffer);

    const expectedHdr = readHdr(writeHdr(original));
    const result = compareFloatImages(expectedHdr, fromHdr, TOLERANCE);
    expect(result.match, `EXR->HDR path failed: maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`).toBe(true);
  });

  it('HDR -> EXR -> HDR: intermediate EXR matches writeExr(original)', () => {
    const hdrBuffer = writeHdr(original);
    const fromHdr = readHdr(hdrBuffer);
    const exrBuffer = writeExr(fromHdr);
    const fromExr = readExr(exrBuffer);

    const expectedExr = readExr(writeExr(original));
    const result = compareFloatImages(expectedExr, fromExr, TOLERANCE);
    expect(result.match, `HDR->EXR path failed: maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`).toBe(true);
  });
});
