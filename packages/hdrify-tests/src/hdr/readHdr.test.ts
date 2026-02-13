import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyToneMapping, convertHDRToLDR, hdrToLdr, readHdr } from 'hdrify';
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
        const exp = Number(result.metadata.EXPOSURE);
        expect(Number.isFinite(exp)).toBe(true);
        expect(exp).toBeGreaterThan(0);
      }
      if (result.metadata?.GAMMA !== undefined) {
        const gamma = Number(result.metadata.GAMMA);
        expect(Number.isFinite(gamma)).toBe(true);
        expect(gamma).toBeGreaterThan(0);
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

    it('should use default exposure when not provided', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const hdrImage = readHdr(hdrBuffer);
      const ldrData1 = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height);
      const ldrData2 = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height, {
        exposure: 1.0,
      });

      expect(uint8ArrayCompare(ldrData1, ldrData2)).toBe(0);
    });

    it('should apply aces tone mapping when specified', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const hdrImage = readHdr(hdrBuffer);
      const ldrReinhard = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height, {
        toneMapping: 'reinhard',
      });
      const ldrAces = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height, {
        toneMapping: 'aces',
      });

      expect(ldrAces.length).toBe(ldrReinhard.length);
      expect(uint8ArrayCompare(ldrAces, ldrReinhard)).not.toBe(0);
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

    it('should throw when format specifier is missing', () => {
      const badBuffer = new TextEncoder().encode('#?RADIANCE\n\n-Y 1 +X 1\n');
      expect(() => readHdr(badBuffer)).toThrow(/missing format specifier/);
    });

    it('should throw when image dimensions are invalid (zero)', () => {
      const badBuffer = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 0 +X 1\n');
      expect(() => readHdr(badBuffer)).toThrow(/invalid image dimensions/);
    });

    it('should read flat/uncompressed HDR (1x1)', () => {
      const header = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n\n';
      const pixels = new Uint8Array([0, 0, 0, 128]); // R=0 G=0 B=0 E=128
      const buffer = new Uint8Array([...new TextEncoder().encode(header), ...pixels]);
      const result = readHdr(buffer);

      expect(result.width).toBe(1);
      expect(result.height).toBe(1);
      expect(result.data.length).toBe(4);
      expect(result.data[0]).toBeCloseTo(0);
      expect(result.data[1]).toBeCloseTo(0);
      expect(result.data[2]).toBeCloseTo(0);
      expect(result.data[3]).toBe(1);
    });

    it('should read flat/uncompressed HDR (4x4) with narrow scanline', () => {
      const header = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 4 +X 4\n\n';
      const pixels = new Uint8Array(4 * 4 * 4);
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 64;
        pixels[i + 1] = 64;
        pixels[i + 2] = 64;
        pixels[i + 3] = 128;
      }
      const buffer = new Uint8Array([...new TextEncoder().encode(header), ...pixels]);
      const result = readHdr(buffer);

      expect(result.width).toBe(4);
      expect(result.height).toBe(4);
      expect(result.data.length).toBe(64);
    });

    it('should read old RLE format (2x2)', () => {
      const header = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n\n';
      // Old RLE: first pixel [64,64,64,128], then repeat 15x -> 16 pixels total
      const pixels = new Uint8Array([64, 64, 64, 128, 255, 255, 255, 15]);
      const buffer = new Uint8Array([...new TextEncoder().encode(header), ...pixels]);
      const result = readHdr(buffer);

      expect(result.width).toBe(2);
      expect(result.height).toBe(2);
      expect(result.data.length).toBe(16);
      const scale = 2 ** (128 - 128) / 255;
      expect(result.data[0]).toBeCloseTo(64 * scale);
    });

    it('should read standard RLE format (8x8)', () => {
      const header = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 8 +X 8\n\n';
      const headerBytes = new TextEncoder().encode(header);
      const rlePixelData: number[] = [];
      for (let y = 0; y < 8; y++) {
        rlePixelData.push(2, 2, 0, 8);
        for (let c = 0; c < 4; c++) {
          const val = c === 3 ? 128 : 64;
          rlePixelData.push(8, val, val, val, val, val, val, val, val);
        }
      }
      const buffer = new Uint8Array([...headerBytes, ...rlePixelData]);
      const result = readHdr(buffer);

      expect(result.width).toBe(8);
      expect(result.height).toBe(8);
      expect(result.data.length).toBe(256);
    });

    it('should throw when flat pixel data has wrong length', () => {
      const header = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n\n';
      const pixels = new Uint8Array([0, 0, 0, 128]);
      const buffer = new Uint8Array([...new TextEncoder().encode(header), ...pixels]);
      expect(() => readHdr(buffer)).toThrow(/expected \d+ bytes/);
    });

    it('should throw when buffer is empty', () => {
      expect(() => readHdr(new Uint8Array(0))).toThrow(/no header found/);
    });

    it('should throw when missing image size specifier', () => {
      const badBuffer = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n');
      expect(() => readHdr(badBuffer)).toThrow(/missing image size specifier/);
    });
  });

  describe('applyToneMapping', () => {
    it('should apply aces tone mapping when specified', () => {
      if (hdrFiles.length === 0) return;
      const [_filename, filepath] = hdrFiles[0] ?? [];
      if (!filepath) return;
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const hdrImage = readHdr(hdrBuffer);
      const ldrAces = applyToneMapping(hdrImage.data, hdrImage.width, hdrImage.height, {
        toneMapping: 'aces',
      });
      const ldrReinhard = applyToneMapping(hdrImage.data, hdrImage.width, hdrImage.height, {
        toneMapping: 'reinhard',
      });

      expect(ldrAces.length).toBe(hdrImage.width * hdrImage.height * 3);
      expect(uint8ArrayCompare(ldrAces, ldrReinhard)).not.toBe(0);
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

    it('should allow overriding exposure', () => {
      const hdrBuffer = toUint8Array(fs.readFileSync(filepath));
      const resultDefault = convertHDRToLDR(hdrBuffer);
      const resultCustom = convertHDRToLDR(hdrBuffer, {
        exposure: 2.0,
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
