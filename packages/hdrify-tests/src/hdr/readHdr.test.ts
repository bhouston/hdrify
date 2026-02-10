import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertHDRToLDR, hdrToLdr, readHdr } from 'hdrify';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../../..');
const assetsDir = path.join(workspaceRoot, 'assets');

function toUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function uint8ArrayCompare(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

const hdrFiles = fs.existsSync(assetsDir)
  ? fs
      .readdirSync(assetsDir)
      .filter((f) => f.endsWith('.hdr'))
      .map((f) => [f, path.join(assetsDir, f)] as [string, string])
  : [];

describe('hdrReader', () => {
  describe.each(hdrFiles)('readHdr (%s)', (_filename, filepath) => {
    it('should parse a valid HDR file', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const result = readHdr(hdrBuffer);

      expect(result).toBeDefined();
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.data).toBeInstanceOf(Float32Array);
      expect(result.data.length).toBe(result.width * result.height * 4);
    });

    it('should return exposure and gamma in metadata if present in file', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const result = readHdr(hdrBuffer);

      if (result.metadata?.EXPOSURE !== undefined) {
        expect(typeof result.metadata.EXPOSURE).toBe('number');
        expect(result.metadata.EXPOSURE).toBeGreaterThan(0);
      }
      if (result.metadata?.GAMMA !== undefined) {
        expect(typeof result.metadata.GAMMA).toBe('number');
        expect(result.metadata.GAMMA).toBeGreaterThan(0);
      }
    });

    it('should handle HDR data with valid dimensions', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const result = readHdr(hdrBuffer);

      const expectedDataLength = result.width * result.height * 4;
      expect(result.data.length).toBe(expectedDataLength);
    });

    it('should include metadata from header', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const result = readHdr(hdrBuffer);

      expect(result.metadata).toBeDefined();
      expect(result.metadata).toBeInstanceOf(Object);
      expect(result.metadata?.FORMAT).toBe('32-bit_rle_rgbe');
    });
  });

  describe.each(hdrFiles)('hdrToLdr (%s)', (_filename, filepath) => {
    it('should convert HDR data to LDR uint8 buffer', { timeout: 30000 }, () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const hdrImage = readHdr(hdrBuffer);
      const ldrData = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height);

      expect(ldrData).toBeInstanceOf(Uint8Array);
      expect(ldrData.length).toBe(hdrImage.width * hdrImage.height * 3);

      const sampleSize = Math.min(1000, ldrData.length);
      for (let i = 0; i < sampleSize; i++) {
        expect(ldrData[i]).toBeGreaterThanOrEqual(0);
        expect(ldrData[i]).toBeLessThanOrEqual(255);
      }
    });

    it('should apply custom exposure', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const hdrImage = readHdr(hdrBuffer);
      const ldrDataDefault = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height, {
        exposure: 1.0,
      });
      const ldrDataHighExposure = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height, {
        exposure: 2.0,
      });

      expect(ldrDataDefault.length).toBe(ldrDataHighExposure.length);
    });

    it('should apply custom gamma correction', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const hdrImage = readHdr(hdrBuffer);
      const ldrDataGamma1 = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height, {
        gamma: 1.0,
      });
      const ldrDataGamma22 = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height, {
        gamma: 2.2,
      });

      const hasContent = ldrDataGamma1.some((b) => b > 0 && b < 255);
      if (hasContent) expect(uint8ArrayCompare(ldrDataGamma1, ldrDataGamma22)).not.toBe(0);
    });

    it('should use default exposure and gamma when not provided', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const hdrImage = readHdr(hdrBuffer);
      const ldrData1 = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height);
      const ldrData2 = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height, {
        exposure: 1.0,
        gamma: 2.2,
      });

      expect(uint8ArrayCompare(ldrData1, ldrData2)).toBe(0);
    });
  });

  describe('readHdr options', () => {
    it('should throw when headerStrict and magic is not RADIANCE', () => {
      const badBuffer = new TextEncoder().encode(
        '#?OTHER\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n' +
          String.fromCharCode(2, 2, 0, 1) +
          String.fromCharCode(0, 0, 0, 128).repeat(4),
      );
      expect(() => readHdr(badBuffer, { headerStrict: true })).toThrow(/expected #\?RADIANCE/);
    });

    it('should accept non-RADIANCE when headerStrict is false', () => {
      if (!fs.existsSync(assetsDir)) return;
      const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.hdr'));
      const file = files[0];
      if (!file) return;
      const buffer = toUint8Array(fs.readFileSync(path.join(assetsDir, file)));
      const radiance = new TextEncoder().encode('#?RADIANCE');
      const other = new TextEncoder().encode('#?OTHER');
      let idx = -1;
      for (let i = 0; i <= buffer.length - radiance.length; i++) {
        let match = true;
        for (let j = 0; j < radiance.length; j++) {
          if (buffer[i + j] !== radiance[j]) {
            match = false;
            break;
          }
        }
        // biome-ignore lint/nursery/noUnnecessaryConditions: match is set false in loop when bytes differ
        if (match) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        const modified = new Uint8Array(buffer);
        modified.set(other, idx);
        const result = readHdr(modified, { headerStrict: false });
        expect(result.width).toBeGreaterThan(0);
      }
    });

    it('should throw when FORMAT is 32-bit_rle_xyze', () => {
      const badBuffer = new TextEncoder().encode(
        '#?RADIANCE\nFORMAT=32-bit_rle_xyze\n\n-Y 1 +X 1\n' +
          String.fromCharCode(2, 2, 0, 1) +
          String.fromCharCode(0, 0, 0, 128).repeat(4),
      );
      expect(() => readHdr(badBuffer)).toThrow(/XYZ format is not supported/);
    });

    it('should throw when resolution is unsupported', () => {
      const badBuffer = new TextEncoder().encode(
        '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n+Y 1 +X 1\n' +
          String.fromCharCode(2, 2, 0, 1) +
          String.fromCharCode(0, 0, 0, 128).repeat(4),
      );
      expect(() => readHdr(badBuffer)).toThrow(/Unsupported resolution format/);
    });

    it('should apply physicalRadiance when output option is set', () => {
      if (!fs.existsSync(assetsDir)) return;
      const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.hdr'));
      const file = files[0];
      if (!file) return;
      const buffer = toUint8Array(fs.readFileSync(path.join(assetsDir, file)));
      const raw = readHdr(buffer, { output: 'raw' });
      const physical = readHdr(buffer, { output: 'physicalRadiance' });
      const exposure = raw.metadata?.EXPOSURE as number | undefined;
      if ((exposure ?? 1) !== 1) {
        const scale = 1 / (exposure ?? 1);
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

  describe.each(hdrFiles)('convertHDRToLDR (%s)', (_filename, filepath) => {
    it('should convert HDR buffer to LDR buffer', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const result = convertHDRToLDR(hdrBuffer);

      expect(result).toBeDefined();
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.ldrData).toBeInstanceOf(Uint8Array);
      expect(result.ldrData.length).toBe(result.width * result.height * 3);
    });

    it('should use exposure and gamma from HDR file if available', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const result = convertHDRToLDR(hdrBuffer);

      expect(result.ldrData.length).toBeGreaterThan(0);
    });

    it('should allow overriding exposure and gamma', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const resultDefault = convertHDRToLDR(hdrBuffer);
      const resultCustom = convertHDRToLDR(hdrBuffer, {
        exposure: 2.0,
        gamma: 1.8,
      });

      const hasContent = resultDefault.ldrData.some((b) => b > 0 && b < 255);
      if (hasContent) expect(uint8ArrayCompare(resultDefault.ldrData, resultCustom.ldrData)).not.toBe(0);
    });

    it('should produce valid image dimensions', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const result = convertHDRToLDR(hdrBuffer);

      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.width).toBeLessThan(100000);
      expect(result.height).toBeLessThan(100000);
    });

    it('should successfully process HDR file with variation', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
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

      expect(nonZeroPixels > 0 || nonMaxPixels > 0).toBe(true);
    });
  });
});
