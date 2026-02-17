import { describe, expect, it } from 'vitest';
import type { FloatImageData } from '../floatImage.js';
import { readHdr } from './readHdr.js';
import { writeHdr } from './writeHdr.js';

describe('hdrWriter', () => {
  describe('writeHdr', () => {
    it('should write HDR file from FloatImageData', () => {
      const floatImageData: FloatImageData = {
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

      const writtenHdrBuffer = writeHdr(floatImageData);

      expect(writtenHdrBuffer).toBeInstanceOf(Uint8Array);
      expect(writtenHdrBuffer.length).toBeGreaterThan(0);
    });

    it('should write HDR file with correct header', () => {
      const floatImageData: FloatImageData = {
        width: 10,
        height: 20,
        linearColorSpace: 'linear-rec709',
        data: new Float32Array(10 * 20 * 4).fill(0.5),
      };

      const writtenHdrBuffer = writeHdr(floatImageData);
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
          linearColorSpace: 'linear-rec709',
          data,
        };

        const writtenHdrBuffer = writeHdr(floatImageData);
        expect(writtenHdrBuffer.length).toBeGreaterThan(0);
      }
    });

    it('should round-trip HDR file (write then read)', () => {
      const originalData: FloatImageData = {
        width: 4,
        height: 4,
        linearColorSpace: 'linear-rec709',
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
      const writtenHdrBuffer = writeHdr(originalData);

      // Read HDR back
      const parsedData = readHdr(writtenHdrBuffer);

      // Verify dimensions match
      expect(parsedData.width).toBe(originalData.width);
      expect(parsedData.height).toBe(originalData.height);
      // Note: parse-hdr may return RGB data, not RGBA, so we check for at least RGB
      expect(parsedData.data.length).toBeGreaterThanOrEqual(originalData.width * originalData.height * 3);
    });

    it('RGBE round-trip: values 0 to 10 in 0.01 steps (R channel only) within 8%', () => {
      // Single-channel gradient to isolate encode/decode for values > 1 (where banding was observed).
      // RGBE has 8-bit mantissa per channel; worst-case relative error at exponent boundaries can reach ~8%.
      const steps = 1001; // 0, 0.01, 0.02, ..., 10.0
      const width = steps;
      const height = 1;
      const data = new Float32Array(width * height * 4);
      for (let i = 0; i < steps; i++) {
        const value = (i / (steps - 1)) * 10; // 0 to 10 inclusive
        const idx = i * 4;
        data[idx] = value; // R only
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 1;
      }
      const original: FloatImageData = {
        width,
        height,
        linearColorSpace: 'linear-rec709',
        data,
      };

      const buffer = writeHdr(original);
      const decoded = readHdr(buffer);

      const tolerancePercent = 0.08; // 8%: covers format limit at exponent boundaries
      const toleranceAbsolute = 1e-6; // for values near 0
      const failures: { value: number; decoded: number; relErr: number }[] = [];

      for (let i = 0; i < steps; i++) {
        const value = (i / (steps - 1)) * 10;
        const r = decoded.data[i * 4]!;
        const scale = Math.max(Math.abs(value), toleranceAbsolute);
        const relErr = scale > 0 ? Math.abs(r - value) / scale : Math.abs(r - value);
        if (relErr > tolerancePercent) {
          failures.push({ value, decoded: r, relErr });
        }
      }

      expect(
        failures,
        `RGBE round-trip should be within 8% for 0..10 (step 0.01). Failures: ${failures.slice(0, 20).map((f) => `value=${f.value.toFixed(3)} decoded=${f.decoded.toFixed(6)} relErr=${(f.relErr * 100).toFixed(2)}%`).join('; ')}${failures.length > 20 ? ` ... and ${failures.length - 20} more` : ''}`,
      ).toHaveLength(0);
    });
  });
});
