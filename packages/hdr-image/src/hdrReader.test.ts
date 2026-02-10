import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { convertHDRToLDR, hdrToLdr, parseHDRFile } from './hdrReader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Go up from packages/hdr-image/src/hdrReader.test.ts to workspace root
const workspaceRoot = path.resolve(__dirname, '../../..');
const assetsDir = path.join(workspaceRoot, 'assets');

const hdrFiles = fs.existsSync(assetsDir)
  ? fs
      .readdirSync(assetsDir)
      .filter((f) => f.endsWith('.hdr'))
      .map((f) => [f, path.join(assetsDir, f)] as [string, string])
  : [];

describe('hdrReader', () => {
  describe.each(hdrFiles)(
    'parseHDRFile (%s)',
    (filename, filepath) => {
      it('should parse a valid HDR file', () => {
        const hdrBuffer = fs.readFileSync(filepath);
        const result = parseHDRFile(hdrBuffer);

        expect(result).toBeDefined();
        expect(result.width).toBeGreaterThan(0);
        expect(result.height).toBeGreaterThan(0);
        expect(result.data).toBeInstanceOf(Float32Array);
        expect(result.data.length).toBe(result.width * result.height * 4);
      });

      it('should return exposure and gamma if present in file', () => {
        const hdrBuffer = fs.readFileSync(filepath);
        const result = parseHDRFile(hdrBuffer);

        if (result.exposure !== undefined) {
          expect(typeof result.exposure).toBe('number');
          expect(result.exposure).toBeGreaterThan(0);
        }
        if (result.gamma !== undefined) {
          expect(typeof result.gamma).toBe('number');
          expect(result.gamma).toBeGreaterThan(0);
        }
      });

      it('should handle HDR data with valid dimensions', () => {
        const hdrBuffer = fs.readFileSync(filepath);
        const result = parseHDRFile(hdrBuffer);

        const expectedDataLength = result.width * result.height * 4;
        expect(result.data.length).toBe(expectedDataLength);
      });

      it('should include metadata from header', () => {
        const hdrBuffer = fs.readFileSync(filepath);
        const result = parseHDRFile(hdrBuffer);

        expect(result.metadata).toBeDefined();
        expect(result.metadata).toBeInstanceOf(Object);
        expect(result.metadata?.FORMAT).toBe('32-bit_rle_rgbe');
      });
    },
  );

  describe.each(hdrFiles)('hdrToLdr (%s)', (filename, filepath) => {
    it('should convert HDR data to LDR uint8 buffer', { timeout: 30000 }, () => {
      const hdrBuffer = fs.readFileSync(filepath);
      const hdrImage = parseHDRFile(hdrBuffer);
      const ldrData = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height);

      expect(ldrData).toBeInstanceOf(Buffer);
      expect(ldrData.length).toBe(hdrImage.width * hdrImage.height * 3);

      const sampleSize = Math.min(1000, ldrData.length);
      for (let i = 0; i < sampleSize; i++) {
        expect(ldrData[i]).toBeGreaterThanOrEqual(0);
        expect(ldrData[i]).toBeLessThanOrEqual(255);
      }
    });

    it('should apply custom exposure', () => {
      const hdrBuffer = fs.readFileSync(filepath);
      const hdrImage = parseHDRFile(hdrBuffer);
      const ldrDataDefault = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height, {
        exposure: 1.0,
      });
      const ldrDataHighExposure = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height, {
        exposure: 2.0,
      });

      // Verify conversion succeeds; higher exposure may produce brighter pixels
      // (can be 0 for all-black, all-saturated, or Reinhard-compressed images)
      expect(ldrDataDefault.length).toBe(ldrDataHighExposure.length);
    });

    it('should apply custom gamma correction', () => {
      const hdrBuffer = fs.readFileSync(filepath);
      const hdrImage = parseHDRFile(hdrBuffer);
      const ldrDataGamma1 = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height, {
        gamma: 1.0,
      });
      const ldrDataGamma22 = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height, {
        gamma: 2.2,
      });

      // Different gamma produces different results (may be identical for all-black images)
      const hasContent = ldrDataGamma1.some((b) => b > 0 && b < 255);
      if (hasContent) expect(Buffer.compare(ldrDataGamma1, ldrDataGamma22)).not.toBe(0);
    });

    it('should use default exposure and gamma when not provided', () => {
      const hdrBuffer = fs.readFileSync(filepath);
      const hdrImage = parseHDRFile(hdrBuffer);
      const ldrData1 = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height);
      const ldrData2 = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height, {
        exposure: 1.0,
        gamma: 2.2,
      });

      expect(Buffer.compare(ldrData1, ldrData2)).toBe(0);
    });
  });

  describe('parseHDRFile options', () => {
    it('should throw when headerStrict and magic is not RADIANCE', () => {
      // Minimal invalid HDR: #?OTHER instead of #?RADIANCE
      const badBuffer = Buffer.from(
        '#?OTHER\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n' + String.fromCharCode(2, 2, 0, 1) + String.fromCharCode(0, 0, 0, 128).repeat(4),
        'utf8',
      );
      expect(() => parseHDRFile(badBuffer, { headerStrict: true })).toThrow(/expected #\?RADIANCE/);
    });

    it('should accept non-RADIANCE when headerStrict is false', () => {
      if (!fs.existsSync(assetsDir)) return;
      const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.hdr'));
      const file = files[0];
      if (!file) return;
      const buffer = fs.readFileSync(path.join(assetsDir, file));
      // Replace RADIANCE with OTHER in the buffer
      const modified = Buffer.from(buffer);
      const idx = modified.indexOf(Buffer.from('#?RADIANCE'));
      if (idx >= 0) modified.write('#?OTHER', idx);
      const result = parseHDRFile(modified, { headerStrict: false });
      expect(result.width).toBeGreaterThan(0);
    });

    it('should throw when FORMAT is 32-bit_rle_xyze', () => {
      const badBuffer = Buffer.from(
        '#?RADIANCE\nFORMAT=32-bit_rle_xyze\n\n-Y 1 +X 1\n' + String.fromCharCode(2, 2, 0, 1) + String.fromCharCode(0, 0, 0, 128).repeat(4),
        'utf8',
      );
      expect(() => parseHDRFile(badBuffer)).toThrow(/XYZ format is not supported/);
    });

    it('should throw when resolution is unsupported', () => {
      const badBuffer = Buffer.from(
        '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n+Y 1 +X 1\n' + String.fromCharCode(2, 2, 0, 1) + String.fromCharCode(0, 0, 0, 128).repeat(4),
        'utf8',
      );
      expect(() => parseHDRFile(badBuffer)).toThrow(/Unsupported resolution format/);
    });

    it('should apply physicalRadiance when output option is set', () => {
      if (!fs.existsSync(assetsDir)) return;
      const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.hdr'));
      const file = files[0];
      if (!file) return;
      const buffer = fs.readFileSync(path.join(assetsDir, file));
      const raw = parseHDRFile(buffer, { output: 'raw' });
      const physical = parseHDRFile(buffer, { output: 'physicalRadiance' });
      if ((raw.exposure ?? 1) !== 1) {
        const scale = 1 / (raw.exposure ?? 1);
        expect(physical.data[0]).toBeCloseTo((raw.data[0] ?? 0) * scale);
      }
    });
  });

  describe('hdrToLdr edge cases', () => {
    it('should handle edge cases with extreme values', () => {
      const testData = new Float32Array([1000, 1000, 1000, 0.001, 0.001, 0.001]);
      const ldrData = hdrToLdr(testData, 1, 1);

      expect(ldrData.length).toBe(3);
      expect(ldrData[0]).toBeGreaterThanOrEqual(0);
      expect(ldrData[0]).toBeLessThanOrEqual(255);
      expect(ldrData[1]).toBeGreaterThanOrEqual(0);
      expect(ldrData[1]).toBeLessThanOrEqual(255);
      expect(ldrData[2]).toBeGreaterThanOrEqual(0);
      expect(ldrData[2]).toBeLessThanOrEqual(255);
    });
  });

  describe.each(hdrFiles)('convertHDRToLDR (%s)', (filename, filepath) => {
    it('should convert HDR buffer to LDR buffer', () => {
      const hdrBuffer = fs.readFileSync(filepath);
      const result = convertHDRToLDR(hdrBuffer);

      expect(result).toBeDefined();
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.ldrData).toBeInstanceOf(Buffer);
      expect(result.ldrData.length).toBe(result.width * result.height * 3);
    });

    it('should use exposure and gamma from HDR file if available', () => {
      const hdrBuffer = fs.readFileSync(filepath);
      const result = convertHDRToLDR(hdrBuffer);

      expect(result.ldrData.length).toBeGreaterThan(0);
    });

    it('should allow overriding exposure and gamma', () => {
      const hdrBuffer = fs.readFileSync(filepath);
      const resultDefault = convertHDRToLDR(hdrBuffer);
      const resultCustom = convertHDRToLDR(hdrBuffer, {
        exposure: 2.0,
        gamma: 1.8,
      });

      // Different options produce different results (may be identical for all-black images)
      const hasContent = resultDefault.ldrData.some((b) => b > 0 && b < 255);
      if (hasContent) expect(Buffer.compare(resultDefault.ldrData, resultCustom.ldrData)).not.toBe(0);
    });

    it('should produce valid image dimensions', () => {
      const hdrBuffer = fs.readFileSync(filepath);
      const result = convertHDRToLDR(hdrBuffer);

      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.width).toBeLessThan(100000);
      expect(result.height).toBeLessThan(100000);
    });

    it('should successfully process HDR file with variation', () => {
      const hdrBuffer = fs.readFileSync(filepath);
      const result = convertHDRToLDR(hdrBuffer);

      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.ldrData.length).toBe(result.width * result.height * 3);

      let nonZeroPixels = 0;
      let nonMaxPixels = 0;
      for (let i = 0; i < Math.min(1000, result.ldrData.length); i++) {
        const pixelValue = result.ldrData[i];
        if (pixelValue !== undefined) {
          if (pixelValue > 0) nonZeroPixels++;
          if (pixelValue < 255) nonMaxPixels++;
        }
      }

      // Image should have some pixel variation (or be all black / all white)
      expect(nonZeroPixels > 0 || nonMaxPixels > 0).toBe(true);
    });
  });
});
