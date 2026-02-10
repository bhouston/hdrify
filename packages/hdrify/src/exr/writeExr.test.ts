import { describe, expect, it } from 'vitest';
import type { FloatImageData } from '../floatImage.js';
import { PIZ_COMPRESSION, PXR24_COMPRESSION, RLE_COMPRESSION, ZIP_COMPRESSION } from './exrConstants.js';
import { readExr } from './readExr.js';
import { writeExr } from './writeExr.js';

describe('exrWriter', () => {
  describe('writeExr', () => {
    it('should write EXR file from FloatImageData', () => {
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

      const exrBuffer = writeExr(floatImageData);

      expect(exrBuffer).toBeInstanceOf(Uint8Array);
      expect(exrBuffer.length).toBeGreaterThan(0);
    });

    it('should write EXR file with correct magic number', () => {
      const floatImageData: FloatImageData = {
        width: 1,
        height: 1,
        data: new Float32Array([1.0, 1.0, 1.0, 1.0]),
      };

      const exrBuffer = writeExr(floatImageData);

      // EXR magic number is 20000630 (little-endian)
      const magic = new DataView(exrBuffer.buffer, exrBuffer.byteOffset, exrBuffer.byteLength).getUint32(0, true);
      expect(magic).toBe(20000630);
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

        const exrBuffer = writeExr(floatImageData);
        expect(exrBuffer.length).toBeGreaterThan(0);
      }
    });

    it('should round-trip EXR file (write then read)', () => {
      const originalData: FloatImageData = {
        width: 4,
        height: 4,
        data: new Float32Array(4 * 4 * 4),
      };

      // Fill with test pattern (use simpler values that round-trip better)
      for (let i = 0; i < originalData.data.length; i += 4) {
        const _pixelIndex = i / 4;
        originalData.data[i] = 0.25; // R - simple value
        originalData.data[i + 1] = 0.5; // G - simple value
        originalData.data[i + 2] = 0.75; // B - simple value
        originalData.data[i + 3] = 1.0; // A
      }

      // Write EXR
      const exrBuffer = writeExr(originalData);

      // Read EXR back
      const parsedData = readExr(exrBuffer);

      // Verify dimensions match
      expect(parsedData.width).toBe(originalData.width);
      expect(parsedData.height).toBe(originalData.height);
      expect(parsedData.data.length).toBe(originalData.data.length);

      // Verify pixel data matches (within tolerance for half-float precision, default is ZIP)
      const tolerance = 0.01; // half-float precision
      for (let i = 0; i < originalData.data.length; i++) {
        const original = originalData.data[i];
        const parsed = parsedData.data[i];
        if (original !== undefined && parsed !== undefined) {
          expect(Math.abs(original - parsed)).toBeLessThanOrEqual(tolerance);
        }
      }
    });

    it('should round-trip EXR with RLE compression', () => {
      const originalData: FloatImageData = {
        width: 4,
        height: 4,
        data: new Float32Array(4 * 4 * 4),
      };
      for (let i = 0; i < originalData.data.length; i += 4) {
        originalData.data[i] = 0.25;
        originalData.data[i + 1] = 0.5;
        originalData.data[i + 2] = 0.75;
        originalData.data[i + 3] = 1.0;
      }

      const exrBuffer = writeExr(originalData, { compression: RLE_COMPRESSION });
      const parsedData = readExr(exrBuffer);

      expect(parsedData.width).toBe(originalData.width);
      expect(parsedData.height).toBe(originalData.height);
      const tolerance = 0.01; // half-float precision
      for (let i = 0; i < originalData.data.length; i++) {
        const original = originalData.data[i];
        const parsed = parsedData.data[i];
        if (original !== undefined && parsed !== undefined) {
          expect(Math.abs(original - parsed)).toBeLessThan(tolerance);
        }
      }
    });

    it('should round-trip EXR with ZIP compression', () => {
      const originalData: FloatImageData = {
        width: 16,
        height: 16,
        data: new Float32Array(16 * 16 * 4),
      };
      for (let i = 0; i < originalData.data.length; i += 4) {
        originalData.data[i] = 0.25;
        originalData.data[i + 1] = 0.5;
        originalData.data[i + 2] = 0.75;
        originalData.data[i + 3] = 1.0;
      }

      const exrBuffer = writeExr(originalData, { compression: ZIP_COMPRESSION });
      const parsedData = readExr(exrBuffer);

      expect(parsedData.width).toBe(originalData.width);
      expect(parsedData.height).toBe(originalData.height);
      const tolerance = 0.01; // half-float precision
      for (let i = 0; i < originalData.data.length; i++) {
        const original = originalData.data[i];
        const parsed = parsedData.data[i];
        if (original !== undefined && parsed !== undefined) {
          expect(Math.abs(original - parsed)).toBeLessThan(tolerance);
        }
      }
    });

    it('should round-trip EXR with PIZ compression', () => {
      const originalData: FloatImageData = {
        width: 32,
        height: 32,
        data: new Float32Array(32 * 32 * 4),
      };
      for (let i = 0; i < originalData.data.length; i += 4) {
        originalData.data[i] = 0.25;
        originalData.data[i + 1] = 0.5;
        originalData.data[i + 2] = 0.75;
        originalData.data[i + 3] = 1.0;
      }

      const exrBuffer = writeExr(originalData, { compression: PIZ_COMPRESSION });
      const parsedData = readExr(exrBuffer);

      expect(parsedData.width).toBe(originalData.width);
      expect(parsedData.height).toBe(originalData.height);
      const tolerance = 0.01; // half-float precision
      for (let i = 0; i < originalData.data.length; i++) {
        const original = originalData.data[i];
        const parsed = parsedData.data[i];
        if (original !== undefined && parsed !== undefined) {
          expect(Math.abs(original - parsed)).toBeLessThan(tolerance);
        }
      }
    });

    it('should round-trip EXR with PXR24 compression', () => {
      const originalData: FloatImageData = {
        width: 16,
        height: 16,
        data: new Float32Array(16 * 16 * 4),
      };
      for (let i = 0; i < originalData.data.length; i += 4) {
        originalData.data[i] = 0.25;
        originalData.data[i + 1] = 0.5;
        originalData.data[i + 2] = 0.75;
        originalData.data[i + 3] = 1.0;
      }

      const exrBuffer = writeExr(originalData, { compression: PXR24_COMPRESSION });
      const parsedData = readExr(exrBuffer);

      expect(parsedData.width).toBe(originalData.width);
      expect(parsedData.height).toBe(originalData.height);
      const tolerance = 0.01; // half-float precision
      for (let i = 0; i < originalData.data.length; i++) {
        const original = originalData.data[i];
        const parsed = parsedData.data[i];
        if (original !== undefined && parsed !== undefined) {
          expect(Math.abs(original - parsed)).toBeLessThan(tolerance);
        }
      }
    });
  });
});
