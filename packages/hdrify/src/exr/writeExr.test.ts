import { describe, expect, it } from 'vitest';
import type { HdrifyImage } from '../hdrifyImage.js';
import {
  B44A_COMPRESSION,
  B44_COMPRESSION,
  DWAA_COMPRESSION,
  DWAB_COMPRESSION,
  PIZ_COMPRESSION,
  PXR24_COMPRESSION,
  RLE_COMPRESSION,
  ZIP_COMPRESSION,
  ZIPS_COMPRESSION,
} from './exrConstants.js';
import { readExr } from './readExr.js';
import { writeExr } from './writeExr.js';

describe('exrWriter', () => {
  describe('writeExr', () => {
    it('should write EXR file from HdrifyImage', () => {
      const hdrifyImage: HdrifyImage = {
        width: 2,
        height: 2,
        linearColorSpace: 'linear-rec709',
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

      const exrBuffer = writeExr(hdrifyImage);

      expect(exrBuffer).toBeInstanceOf(Uint8Array);
      expect(exrBuffer.length).toBeGreaterThan(0);
    });

    it('should write EXR file with correct magic number', () => {
      const hdrifyImage: HdrifyImage = {
        width: 1,
        height: 1,
        linearColorSpace: 'linear-rec709',
        data: new Float32Array([1.0, 1.0, 1.0, 1.0]),
      };

      const exrBuffer = writeExr(hdrifyImage);

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

        const hdrifyImage: HdrifyImage = {
          width: size.width,
          height: size.height,
          linearColorSpace: 'linear-rec709',
          data,
        };

        const exrBuffer = writeExr(hdrifyImage);
        expect(exrBuffer.length).toBeGreaterThan(0);
      }
    });

    it('should round-trip EXR file (write then read)', () => {
      const originalData: HdrifyImage = {
        width: 4,
        height: 4,
        linearColorSpace: 'linear-rec709',
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
      const originalData: HdrifyImage = {
        width: 4,
        height: 4,
        linearColorSpace: 'linear-rec709',
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
      const originalData: HdrifyImage = {
        width: 16,
        height: 16,
        linearColorSpace: 'linear-rec709',
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
      const originalData: HdrifyImage = {
        width: 32,
        height: 32,
        linearColorSpace: 'linear-rec709',
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

    it('should round-trip EXR with ZIPS compression', () => {
      const originalData: HdrifyImage = {
        width: 16,
        height: 16,
        linearColorSpace: 'linear-rec709',
        data: new Float32Array(16 * 16 * 4),
      };
      for (let i = 0; i < originalData.data.length; i += 4) {
        originalData.data[i] = 0.25;
        originalData.data[i + 1] = 0.5;
        originalData.data[i + 2] = 0.75;
        originalData.data[i + 3] = 1.0;
      }
      const exrBuffer = writeExr(originalData, { compression: ZIPS_COMPRESSION });
      const parsedData = readExr(exrBuffer);

      expect(parsedData.width).toBe(originalData.width);
      expect(parsedData.height).toBe(originalData.height);
      const tolerance = 0.01;
      for (let i = 0; i < originalData.data.length; i++) {
        const original = originalData.data[i];
        const parsed = parsedData.data[i];
        if (original !== undefined && parsed !== undefined) {
          expect(Math.abs(original - parsed)).toBeLessThan(tolerance);
        }
      }
    });

    it('should round-trip EXR with PXR24 compression', () => {
      const originalData: HdrifyImage = {
        width: 16,
        height: 16,
        linearColorSpace: 'linear-rec709',
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

    it.each([
      ['B44', B44_COMPRESSION],
      ['B44A', B44A_COMPRESSION],
    ] as const)('should round-trip EXR with %s compression, across multiple 4x4 blocks', (_name, compression) => {
      // Dimensions are not multiples of 4, exercising B44's edge-padding for partial blocks,
      // and span multiple 32-scanline chunks.
      const width = 37;
      const height = 70;
      const originalData: HdrifyImage = {
        width,
        height,
        linearColorSpace: 'linear-rec709',
        data: new Float32Array(width * height * 4),
      };
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          originalData.data[i] = Math.sin(x * 0.2) * 0.5 + 0.5;
          originalData.data[i + 1] = Math.cos(y * 0.15) * 0.5 + 0.5;
          originalData.data[i + 2] = (x + y) / (width + height);
          originalData.data[i + 3] = 1.0;
        }
      }

      const exrBuffer = writeExr(originalData, { compression });
      const parsedData = readExr(exrBuffer);

      expect(parsedData.width).toBe(originalData.width);
      expect(parsedData.height).toBe(originalData.height);
      const tolerance = 0.02; // half-float + B44 quantization precision
      for (let i = 0; i < originalData.data.length; i++) {
        const original = originalData.data[i];
        const parsed = parsedData.data[i];
        if (original !== undefined && parsed !== undefined) {
          expect(Math.abs(original - parsed)).toBeLessThan(tolerance);
        }
      }
    });

    it.each([
      ['B44', B44_COMPRESSION],
      ['B44A', B44A_COMPRESSION],
    ] as const)('should round-trip a flat (constant-value) EXR with %s compression', (_name, compression) => {
      const width = 8;
      const height = 8;
      const originalData: HdrifyImage = {
        width,
        height,
        linearColorSpace: 'linear-rec709',
        data: new Float32Array(width * height * 4),
      };
      for (let i = 0; i < originalData.data.length; i += 4) {
        originalData.data[i] = 0.25;
        originalData.data[i + 1] = 0.5;
        originalData.data[i + 2] = 0.75;
        originalData.data[i + 3] = 1.0;
      }

      const exrBuffer = writeExr(originalData, { compression });
      const parsedData = readExr(exrBuffer);

      expect(parsedData.width).toBe(width);
      expect(parsedData.height).toBe(height);
      for (let i = 0; i < originalData.data.length; i++) {
        expect(parsedData.data[i]).toBeCloseTo(originalData.data[i]!, 2);
      }
    });

    it.each([
      ['DWAA', DWAA_COMPRESSION],
      ['DWAB', DWAB_COMPRESSION],
    ] as const)('should round-trip EXR with %s compression, across multiple blocks', (_name, compression) => {
      // Height spans multiple blocks for both DWAA (32 lines/block) and DWAB (256 lines/block),
      // and is not an exact multiple of either, exercising the final partial block.
      const width = 40;
      const height = 70;
      const originalData: HdrifyImage = {
        width,
        height,
        linearColorSpace: 'linear-rec709',
        data: new Float32Array(width * height * 4),
      };
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          originalData.data[i] = Math.sin(x * 0.2) * 0.5 + 0.5;
          originalData.data[i + 1] = Math.cos(y * 0.15) * 0.5 + 0.5;
          originalData.data[i + 2] = (x + y) / (width + height);
          originalData.data[i + 3] = 1.0;
        }
      }

      const exrBuffer = writeExr(originalData, { compression });
      const parsedData = readExr(exrBuffer);

      expect(parsedData.width).toBe(originalData.width);
      expect(parsedData.height).toBe(originalData.height);
      // Measured max error for this pattern is ~0.0017 (a few half-float ULPs from the DCT
      // round-trip); 0.005 leaves headroom for platform float variance without masking a
      // real regression the way the codec's other 0.01 "half-float precision" tolerance would.
      const tolerance = 0.005;
      for (let i = 0; i < originalData.data.length; i++) {
        const original = originalData.data[i];
        const parsed = parsedData.data[i];
        if (original !== undefined && parsed !== undefined) {
          expect(Math.abs(original - parsed)).toBeLessThan(tolerance);
        }
      }
      // Alpha channel goes through DWA's lossless RLE path, not the lossy DCT path.
      for (let i = 3; i < originalData.data.length; i += 4) {
        expect(parsedData.data[i]).toBeCloseTo(1.0, 5);
      }
    });
  });
});
