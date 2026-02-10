import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FloatImageData } from 'hdrify';
import { compareFloatImages, createHsvRainbowImage, readExr, readHdr, writeExr, writeHdr } from 'hdrify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../../..');
const assetsDir = path.join(workspaceRoot, 'assets');

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
    expect(
      result.match,
      `EXR round-trip failed: maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });

  it('HDR round-trip: writeHdr -> readHdr matches original', () => {
    const buffer = writeHdr(original);
    const parsed = readHdr(buffer);
    const result = compareFloatImages(original, parsed, TOLERANCE);
    expect(
      result.match,
      `HDR round-trip failed: maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });

  it('EXR -> HDR -> EXR: intermediate HDR matches writeHdr(original)', () => {
    const exrBuffer = writeExr(original);
    const fromExr = readExr(exrBuffer);
    const hdrBuffer = writeHdr(fromExr);
    const fromHdr = readHdr(hdrBuffer);

    const expectedHdr = readHdr(writeHdr(original));
    const result = compareFloatImages(expectedHdr, fromHdr, TOLERANCE);
    expect(
      result.match,
      `EXR->HDR path failed: maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });

  it('HDR -> EXR -> HDR: intermediate EXR matches writeExr(original)', () => {
    const hdrBuffer = writeHdr(original);
    const fromHdr = readHdr(hdrBuffer);
    const exrBuffer = writeExr(fromHdr);
    const fromExr = readExr(exrBuffer);

    const expectedExr = readExr(writeExr(original));
    const result = compareFloatImages(expectedExr, fromExr, TOLERANCE);
    expect(
      result.match,
      `HDR->EXR path failed: maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });
});

describe('reference asset comparison', () => {
  const refExrPath = path.join(assetsDir, 'rainbow.exr');
  const refHdrPath = path.join(assetsDir, 'rainbow.hdr');

  it('generated synthetic image matches reference rainbow.exr', () => {
    if (!fs.existsSync(refExrPath)) return;

    const generated = createHsvRainbowImage({ width: 16, height: 16, value: 1, intensity: 1 });
    const refBuffer = new Uint8Array(fs.readFileSync(refExrPath));
    const reference = readExr(refBuffer);

    const result = compareFloatImages(generated, reference, TOLERANCE);
    expect(
      result.match,
      `Generated vs rainbow.exr: maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });

  it('generated synthetic image matches reference rainbow.hdr', () => {
    if (!fs.existsSync(refHdrPath)) return;

    const generated = createHsvRainbowImage({ width: 16, height: 16, value: 1, intensity: 1 });
    const refBuffer = new Uint8Array(fs.readFileSync(refHdrPath));
    const reference = readHdr(refBuffer);

    const result = compareFloatImages(generated, reference, TOLERANCE);
    expect(
      result.match,
      `Generated vs rainbow.hdr: maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });
});
