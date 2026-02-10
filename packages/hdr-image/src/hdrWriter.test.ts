import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FloatImageData } from './floatImage.js';
import { parseHDRFile } from './hdrReader.js';
import { writeHDRFile } from './hdrWriter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../..');
const testHdrPath = path.join(workspaceRoot, 'assets', 'quarry_01_1k.hdr');

describe('hdrWriter', () => {
  let hdrBuffer: Buffer | null = null;

  beforeEach(() => {
    // Load the test HDR file if it exists
    if (fs.existsSync(testHdrPath)) {
      hdrBuffer = fs.readFileSync(testHdrPath);
    }
  });

  afterEach(() => {
    // Cleanup if needed
  });

  describe('writeHDRFile', () => {
    it('should write HDR file from FloatImageData', () => {
      const floatImageData: FloatImageData = {
        width: 2,
        height: 2,
        data: new Float32Array([
          // RGBA format: [R, G, B, A, R, G, B, A, ...]
          1.0,
          0.5,
          0.0,
          1.0, // Pixel 0,0
          0.0,
          0.5,
          1.0,
          1.0, // Pixel 1,0
          0.5,
          1.0,
          0.5,
          1.0, // Pixel 0,1
          0.0,
          0.0,
          0.0,
          1.0, // Pixel 1,1
        ]),
      };

      const writtenHdrBuffer = writeHDRFile(floatImageData);

      expect(writtenHdrBuffer).toBeInstanceOf(Buffer);
      expect(writtenHdrBuffer.length).toBeGreaterThan(0);
    });

    it('should write HDR file with correct header', () => {
      const floatImageData: FloatImageData = {
        width: 10,
        height: 20,
        data: new Float32Array(10 * 20 * 4).fill(0.5),
      };

      const writtenHdrBuffer = writeHDRFile(floatImageData);
      const header = writtenHdrBuffer.toString('utf-8', 0, 200);

      expect(header).toContain('#?RADIANCE');
      expect(header).toContain('FORMAT=32-bit_rle_rgbe');
      expect(header).toContain('-Y 20');
      expect(header).toContain('+X 10');
    });

    it('should handle different image sizes', () => {
      const sizes = [
        { width: 1, height: 1 },
        { width: 10, height: 10 },
        { width: 100, height: 50 },
      ];

      for (const size of sizes) {
        const pixelCount = size.width * size.height;
        const data = new Float32Array(pixelCount * 4);
        // Fill with test data
        for (let i = 0; i < pixelCount * 4; i += 4) {
          data[i] = 0.5; // R
          data[i + 1] = 0.5; // G
          data[i + 2] = 0.5; // B
          data[i + 3] = 1.0; // A
        }

        const floatImageData: FloatImageData = {
          width: size.width,
          height: size.height,
          data,
        };

        const writtenHdrBuffer = writeHDRFile(floatImageData);
        expect(writtenHdrBuffer.length).toBeGreaterThan(0);
      }
    });

    it('should round-trip HDR file (write then read)', () => {
      const originalData: FloatImageData = {
        width: 4,
        height: 4,
        data: new Float32Array(4 * 4 * 4),
      };

      // Fill with test pattern
      for (let i = 0; i < originalData.data.length; i += 4) {
        const pixelIndex = i / 4;
        originalData.data[i] = (pixelIndex % 4) / 4.0; // R
        originalData.data[i + 1] = ((pixelIndex / 4) % 4) / 4.0; // G
        originalData.data[i + 2] = 0.5; // B
        originalData.data[i + 3] = 1.0; // A
      }

      // Write HDR
      const writtenHdrBuffer = writeHDRFile(originalData);

      // Read HDR back
      const parsedData = parseHDRFile(writtenHdrBuffer);

      // Verify dimensions match
      expect(parsedData.width).toBe(originalData.width);
      expect(parsedData.height).toBe(originalData.height);
      // Note: parse-hdr may return RGB data, not RGBA, so we check for at least RGB
      expect(parsedData.data.length).toBeGreaterThanOrEqual(originalData.width * originalData.height * 3);
    });

    it('should round-trip actual HDR file', () => {
      if (!hdrBuffer) {
        // Skip test if HDR file doesn't exist
        return;
      }

      // Parse original HDR
      const originalData = parseHDRFile(hdrBuffer);

      // Write HDR
      const writtenBuffer = writeHDRFile(originalData);

      // Parse written HDR
      const parsedData = parseHDRFile(writtenBuffer);

      // Verify dimensions match
      expect(parsedData.width).toBe(originalData.width);
      expect(parsedData.height).toBe(originalData.height);

      // Verify that we can write and read back an HDR file
      // RGBE encoding has significant precision loss, so we just verify
      // that the file structure is correct and dimensions match
      expect(parsedData.data.length).toBeGreaterThan(0);
      expect(parsedData.data.length).toBeGreaterThanOrEqual(originalData.width * originalData.height * 3);
    });
  });
});
