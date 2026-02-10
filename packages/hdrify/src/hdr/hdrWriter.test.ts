import { describe, expect, it } from 'vitest';
import type { FloatImageData } from '../floatImage.js';
import { parseHDRFile } from './hdrReader.js';
import { writeHDRFile } from './hdrWriter.js';

describe('hdrWriter', () => {
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

      expect(writtenHdrBuffer).toBeInstanceOf(Uint8Array);
      expect(writtenHdrBuffer.length).toBeGreaterThan(0);
    });

    it('should write HDR file with correct header', () => {
      const floatImageData: FloatImageData = {
        width: 10,
        height: 20,
        data: new Float32Array(10 * 20 * 4).fill(0.5),
      };

      const writtenHdrBuffer = writeHDRFile(floatImageData);
      const header = new TextDecoder().decode(writtenHdrBuffer.subarray(0, 200));

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
  });
});
