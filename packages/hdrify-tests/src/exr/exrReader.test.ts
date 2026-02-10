import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEXRFile } from 'hdrify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../../..');
const testExrPath = path.join(workspaceRoot, 'assets', 'piz_compressed.exr');

describe('exrReader', () => {
  let exrBuffer: Uint8Array | null = null;

  beforeEach(() => {
    if (fs.existsSync(testExrPath)) {
      const buf = fs.readFileSync(testExrPath);
      exrBuffer = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
  });

  afterEach(() => {
    // Cleanup if needed
  });

  describe('parseEXRFile', () => {
    it('should parse a valid EXR file', () => {
      if (!exrBuffer) return;

      const result = parseEXRFile(exrBuffer);

      expect(result).toBeDefined();
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.data).toBeInstanceOf(Float32Array);
      expect(result.data.length).toBe(result.width * result.height * 4);
    });

    it('should return FloatImageData with correct structure', () => {
      if (!exrBuffer) return;

      const result = parseEXRFile(exrBuffer);

      expect(result).toHaveProperty('width');
      expect(result).toHaveProperty('height');
      expect(result).toHaveProperty('data');
      expect(typeof result.width).toBe('number');
      expect(typeof result.height).toBe('number');
      expect(result.data).toBeInstanceOf(Float32Array);
    });

    it('should handle EXR data with valid dimensions', () => {
      if (!exrBuffer) return;

      const result = parseEXRFile(exrBuffer);

      const expectedDataLength = result.width * result.height * 4;
      expect(result.data.length).toBe(expectedDataLength);
    });

    it('should parse pixel data correctly', () => {
      if (!exrBuffer) return;

      const result = parseEXRFile(exrBuffer);

      for (let i = 0; i < Math.min(100, result.data.length); i += 4) {
        const r = result.data[i];
        const g = result.data[i + 1];
        const b = result.data[i + 2];
        const a = result.data[i + 3];

        expect(typeof r).toBe('number');
        expect(typeof g).toBe('number');
        expect(typeof b).toBe('number');
        expect(typeof a).toBe('number');
        expect(r).toBeGreaterThanOrEqual(0);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1.0);
      }
    });

    it('should throw error for invalid EXR file', () => {
      const invalidBuffer = new TextEncoder().encode('invalid exr data');

      expect(() => parseEXRFile(invalidBuffer)).toThrow('Invalid EXR file');
    });

    it('should throw error for empty buffer', () => {
      const emptyBuffer = new Uint8Array(0);

      expect(() => parseEXRFile(emptyBuffer)).toThrow();
    });
  });
});
