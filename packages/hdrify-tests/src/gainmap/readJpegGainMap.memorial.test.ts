import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareFloatImages, encodeGainMap, encodeToJpeg, readExr, readJpegGainMap, writeJpegGainMap } from 'hdrify';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../../..');
const assetsDir = path.join(workspaceRoot, 'assets');

const memorialExr = path.join(assetsDir, 'memorial.exr');
const memorialJpg = path.join(assetsDir, 'memorial.jpg');

function toUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Round-trip tolerance: 8-bit + gain map clamping + JPEG loss (memorial has high DR). */
const TOLERANCE_ROUNDTRIP = { tolerancePercent: 1, toleranceAbsolute: 0.01 };

describe('readJpegGainMap', () => {
  describe('throw when no gain map data', () => {
    it('throws when given a plain JPEG (no gain map metadata)', () => {
      const plainJpeg = encodeToJpeg(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1);
      expect(() => readJpegGainMap(plainJpeg.data)).toThrow(/Not a valid JPEG with gain map/);
    });
  });

  describe('memorial assets (smoke)', () => {
    it('loads memorial.exr, memorial.jpg and dimensions match', () => {
      if (!fs.existsSync(memorialExr) || !fs.existsSync(memorialJpg)) {
        return;
      }
      const exr = readExr(toUint8Array(fs.readFileSync(memorialExr)));
      const jpg = readJpegGainMap(toUint8Array(fs.readFileSync(memorialJpg)));
      expect(jpg.width).toBe(exr.width);
      expect(jpg.height).toBe(exr.height);
    });

    it('memorial.jpg result has metadata.format set', () => {
      if (!fs.existsSync(memorialJpg)) return;
      const jpg = readJpegGainMap(toUint8Array(fs.readFileSync(memorialJpg)));
      expect(jpg.metadata?.format).toBeDefined();
      expect(['ultrahdr', 'adobe-gainmap']).toContain(jpg.metadata?.format);
    });
  });

  describe('gain map round-trip (read → encode → write → read)', () => {
    it('EXR → gain map → read that gain map → encode → write → read again: second read matches first read within 5%', () => {
      if (!fs.existsSync(memorialExr)) return;
      const original = readExr(toUint8Array(fs.readFileSync(memorialExr)));
      const encoding = encodeGainMap(original, { toneMapping: 'reinhard' });
      const jpegBuffer = writeJpegGainMap(encoding, { quality: 95 });

      const firstRead = readJpegGainMap(jpegBuffer);
      const reEncode = encodeGainMap(firstRead, { toneMapping: 'reinhard' });
      const jpegBuffer2 = writeJpegGainMap(reEncode, { quality: 95 });
      const secondRead = readJpegGainMap(jpegBuffer2);

      const result = compareFloatImages(firstRead, secondRead, TOLERANCE_ROUNDTRIP);
      expect(
        result.match,
        `Read→write→read round-trip: maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`,
      ).toBe(true);
    });
  });

  describe('EXR → gain map → read (pipeline we control)', () => {
    it('load memorial.exr, encode to gain map, write, read back; decoded matches original EXR within tolerance', () => {
      if (!fs.existsSync(memorialExr)) return;
      const original = readExr(toUint8Array(fs.readFileSync(memorialExr)));
      const encoding = encodeGainMap(original, { toneMapping: 'reinhard' });
      const jpegBuffer = writeJpegGainMap(encoding, { quality: 95 });
      const decoded = readJpegGainMap(jpegBuffer);

      const result = compareFloatImages(original, decoded, TOLERANCE_ROUNDTRIP);
      expect(
        result.match,
        `EXR→gain map→read: maxDiff=${result.maxDiff} mismatchedPixels=${result.mismatchedPixels}`,
      ).toBe(true);
    });
  });
});
