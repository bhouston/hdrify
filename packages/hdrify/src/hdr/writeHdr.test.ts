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

    /** Build 0..10 single-channel R gradient (1001 steps) for round-trip tests */
    function buildGradient010(): FloatImageData {
      const steps = 1001;
      const data = new Float32Array(steps * 4);
      for (let i = 0; i < steps; i++) {
        const value = (i / (steps - 1)) * 10;
        const idx = i * 4;
        data[idx] = value;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 1;
      }
      return { width: steps, height: 1, linearColorSpace: 'linear-rec709' as const, data };
    }

    function roundTripErrors(
      original: FloatImageData,
      buffer: Uint8Array,
    ): { value: number; decoded: number; relErr: number }[] {
      const decoded = readHdr(buffer);
      const steps = original.width * original.height;
      const toleranceAbsolute = 1e-6;
      const failures: { value: number; decoded: number; relErr: number }[] = [];
      for (let i = 0; i < steps; i++) {
        const value = (i / (steps - 1)) * 10;
        const r = decoded.data[i * 4] ?? 0;
        const scale = Math.max(Math.abs(value), toleranceAbsolute);
        const relErr = scale > 0 ? Math.abs(r - value) / scale : Math.abs(r - value);
        failures.push({ value, decoded: r, relErr });
      }
      return failures;
    }

    it('RGBE round-trip: values 0 to 10 in 0.01 steps (R channel only) within 8%', () => {
      const original = buildGradient010();
      const buffer = writeHdr(original);
      const errors = roundTripErrors(original, buffer);
      const toleranceRelative = 0.08;
      const failures = errors.filter((e) => e.relErr > toleranceRelative);
      expect(
        failures,
        `RGBE round-trip should be within 8% for 0..10. Failures: ${failures
          .slice(0, 20)
          .map((f) => `value=${f.value.toFixed(3)} relErr=${(f.relErr * 100).toFixed(2)}%`)
          .join('; ')}${failures.length > 20 ? ` ... and ${failures.length - 20} more` : ''}`,
      ).toHaveLength(0);
    });
  });
});
