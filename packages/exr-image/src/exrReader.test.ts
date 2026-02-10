import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseEXRFile } from './exrReader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Go up from packages/exr-image/src/exrReader.test.ts to workspace root
// From packages/exr-image/src -> packages/exr-image -> packages -> exr-image (root) = 3 levels up
const workspaceRoot = path.resolve(__dirname, '../../..');
const testExrPath = path.join(workspaceRoot, 'assets', 'piz_compressed.exr');

describe('exrReader', () => {
  let exrBuffer: Buffer | null = null;

  beforeEach(() => {
    // Load the test EXR file if it exists
    if (fs.existsSync(testExrPath)) {
      exrBuffer = fs.readFileSync(testExrPath);
    }
  });

  afterEach(() => {
    // Cleanup if needed
  });

  describe('parseEXRFile', () => {
    it('should parse a valid EXR file', () => {
      if (!exrBuffer) {
        // Skip test if EXR file doesn't exist
        return;
      }

      const result = parseEXRFile(exrBuffer);

      expect(result).toBeDefined();
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.data).toBeInstanceOf(Float32Array);
      // EXR data should have width * height * 4 elements (RGBA)
      expect(result.data.length).toBe(result.width * result.height * 4);
    });

    it('should return FloatImageData with correct structure', () => {
      if (!exrBuffer) {
        return;
      }

      const result = parseEXRFile(exrBuffer);

      expect(result).toHaveProperty('width');
      expect(result).toHaveProperty('height');
      expect(result).toHaveProperty('data');
      expect(typeof result.width).toBe('number');
      expect(typeof result.height).toBe('number');
      expect(result.data).toBeInstanceOf(Float32Array);
    });

    it('should handle EXR data with valid dimensions', () => {
      if (!exrBuffer) {
        return;
      }

      const result = parseEXRFile(exrBuffer);

      // Verify dimensions match data length
      const expectedDataLength = result.width * result.height * 4; // RGBA
      expect(result.data.length).toBe(expectedDataLength);
    });

    it('should parse pixel data correctly', () => {
      if (!exrBuffer) {
        return;
      }

      const result = parseEXRFile(exrBuffer);

      // Check that pixel data contains valid float values
      // Sample a few pixels
      for (let i = 0; i < Math.min(100, result.data.length); i += 4) {
        const r = result.data[i];
        const g = result.data[i + 1];
        const b = result.data[i + 2];
        const a = result.data[i + 3];

        expect(typeof r).toBe('number');
        expect(typeof g).toBe('number');
        expect(typeof b).toBe('number');
        expect(typeof a).toBe('number');
        // RGB values should be non-negative (can be very large for HDR)
        expect(r).toBeGreaterThanOrEqual(0);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(b).toBeGreaterThanOrEqual(0);
        // Alpha should be between 0 and 1 (or could be 1.0 for opaque)
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1.0);
      }
    });

    it('should throw error for invalid EXR file', () => {
      const invalidBuffer = Buffer.from('invalid exr data');

      expect(() => {
        parseEXRFile(invalidBuffer);
      }).toThrow('Invalid EXR file');
    });

    it('should throw error for empty buffer', () => {
      const emptyBuffer = Buffer.alloc(0);

      expect(() => {
        parseEXRFile(emptyBuffer);
      }).toThrow();
    });
  });
});
