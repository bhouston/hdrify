import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeGainMap, readExr, readHdr, writeJpegGainMap, writeGainMapAsSeparateFiles } from 'hdrify';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../../..');
const assetsDir = path.join(workspaceRoot, 'assets');

function toUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const hdrFiles = fs.existsSync(assetsDir)
  ? fs
      .readdirSync(assetsDir)
      .filter((f) => f.endsWith('.hdr'))
      .map((f) => [f, path.join(assetsDir, f)] as [string, string])
  : [];

const exrFiles = fs.existsSync(assetsDir)
  ? fs
      .readdirSync(assetsDir)
      .filter((f) => f.endsWith('.exr'))
      .map((f) => [f, path.join(assetsDir, f)] as [string, string])
  : [];

describe('encodeGainMap', () => {
  describe.each(hdrFiles)('from HDR (%s)', (_filename, filepath) => {
    it('should encode HDR to SDR and gain map', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const hdrImage = readHdr(hdrBuffer);
      const result = encodeGainMap(hdrImage);

      expect(result).toBeDefined();
      expect(result.width).toBe(hdrImage.width);
      expect(result.height).toBe(hdrImage.height);
      expect(result.sdr).toBeInstanceOf(Uint8ClampedArray);
      expect(result.gainMap).toBeInstanceOf(Uint8ClampedArray);

      const expectedPixels = hdrImage.width * hdrImage.height * 4;
      expect(result.sdr.length).toBe(expectedPixels);
      expect(result.gainMap.length).toBe(expectedPixels);

      for (let i = 0; i < Math.min(100, result.sdr.length); i++) {
        expect(result.sdr[i]).toBeGreaterThanOrEqual(0);
        expect(result.sdr[i]).toBeLessThanOrEqual(255);
      }
      for (let i = 0; i < Math.min(100, result.gainMap.length); i++) {
        expect(result.gainMap[i]).toBeGreaterThanOrEqual(0);
        expect(result.gainMap[i]).toBeLessThanOrEqual(255);
      }

      expect(result.metadata).toBeDefined();
      expect(result.metadata.gamma).toEqual([1, 1, 1]);
      expect(result.metadata.offsetSdr).toEqual([1 / 64, 1 / 64, 1 / 64]);
      expect(result.metadata.offsetHdr).toEqual([1 / 64, 1 / 64, 1 / 64]);
      expect(result.metadata.gainMapMin).toHaveLength(3);
      expect(result.metadata.gainMapMax).toHaveLength(3);
      expect(result.metadata.hdrCapacityMin).toBeGreaterThanOrEqual(0);
      expect(result.metadata.hdrCapacityMax).toBeGreaterThan(result.metadata.hdrCapacityMin);
    });

    it('should accept custom maxContentBoost', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const hdrImage = readHdr(hdrBuffer);
      const result = encodeGainMap(hdrImage, { maxContentBoost: 8 });

      expect(result.metadata.gainMapMax[0]).toBeCloseTo(Math.log2(8));
    });

    it('should accept toneMapping option', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const hdrImage = readHdr(hdrBuffer);
      const resultAces = encodeGainMap(hdrImage, { toneMapping: 'aces' });
      const resultReinhard = encodeGainMap(hdrImage, { toneMapping: 'reinhard' });

      expect(resultAces.sdr.length).toBe(resultReinhard.sdr.length);
      expect(resultAces.gainMap.length).toBe(resultReinhard.gainMap.length);
    });
  });

  describe.each(exrFiles)('from EXR (%s)', (_filename, filepath) => {
    it('should encode EXR to SDR and gain map', () => {
      const exrBuffer = toUint8Array(fs.readFileSync(filepath));
      const exrImage = readExr(exrBuffer);
      const result = encodeGainMap(exrImage);

      expect(result).toBeDefined();
      expect(result.width).toBe(exrImage.width);
      expect(result.height).toBe(exrImage.height);
      expect(result.sdr.length).toBe(exrImage.width * exrImage.height * 4);
      expect(result.gainMap.length).toBe(exrImage.width * exrImage.height * 4);
      expect(result.metadata).toBeDefined();
    });
  });

  it('should handle edge case with small image', () => {
    const data = new Float32Array([1, 1, 1, 1, 0.5, 0.5, 0.5, 1]);
    const result = encodeGainMap({
      width: 1,
      height: 2,
      data,
    });

    expect(result.sdr.length).toBe(8);
    expect(result.gainMap.length).toBe(8);
  });
});

describe('writeJpegGainMap', () => {
  it('should produce valid JPEG-R file', () => {
    if (hdrFiles.length === 0) return;

    const entry = hdrFiles[0];
    const filepath = entry?.[1];
    if (!filepath) return;
    const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
    const hdrImage = readHdr(hdrBuffer);
    const encodingResult = encodeGainMap(hdrImage);
    const jpegR = writeJpegGainMap(encodingResult);

    expect(jpegR).toBeInstanceOf(Uint8Array);
    expect(jpegR.length).toBeGreaterThan(1000);
    expect(jpegR[0]).toBe(0xff);
    expect(jpegR[1]).toBe(0xd8);
  });

  it('should accept quality option', () => {
    if (hdrFiles.length === 0) return;

    const entry = hdrFiles[0];
    const filepath = entry?.[1];
    if (!filepath) return;
    const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
    const hdrImage = readHdr(hdrBuffer);
    const encodingResult = encodeGainMap(hdrImage);

    const jpegRHigh = writeJpegGainMap(encodingResult, { quality: 95 });
    const jpegRLow = writeJpegGainMap(encodingResult, { quality: 50 });

    expect(jpegRHigh.length).toBeGreaterThanOrEqual(jpegRLow.length);
  });
});

describe('writeGainMapAsSeparateFiles', () => {
  it('should produce SDR JPEG, gain map JPEG, and metadata', () => {
    if (hdrFiles.length === 0) return;

    const entry = hdrFiles[0];
    const filepath = entry?.[1];
    if (!filepath) return;
    const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
    const hdrImage = readHdr(hdrBuffer);
    const encodingResult = encodeGainMap(hdrImage);
    const result = writeGainMapAsSeparateFiles(encodingResult);

    expect(result.sdrImage).toBeInstanceOf(Uint8Array);
    expect(result.gainMapImage).toBeInstanceOf(Uint8Array);
    expect(result.metadata).toBeDefined();

    expect(result.sdrImage[0]).toBe(0xff);
    expect(result.sdrImage[1]).toBe(0xd8);
    expect(result.gainMapImage[0]).toBe(0xff);
    expect(result.gainMapImage[1]).toBe(0xd8);

    expect(result.metadata.gamma).toBeDefined();
    expect(result.metadata.gainMapMin).toBeDefined();
    expect(result.metadata.gainMapMax).toBeDefined();
  });
});
