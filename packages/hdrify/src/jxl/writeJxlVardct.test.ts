import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertLinearColorSpace } from '../color/convert.js';
import { writeExr } from '../exr/writeExr.js';
import { encodeFloat16, decodeFloat16 } from '../exr/halfFloat.js';
import { readExr } from '../exr/readExr.js';
import type { HdrifyImage } from '../hdrifyImage.js';
import { JxlBitReader } from './jxlBitReader.js';
import { readFrameHeader } from './jxlFrameHeader.js';
import { readImageHeader } from './jxlImageHeader.js';
import { readJxl } from './readJxl.js';
import { writeJxl } from './writeJxl.js';

function pattern(width: number, height: number, alpha = false, peak = 8): HdrifyImage {
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      data[p] = (peak * x) / width;
      data[p + 1] = (peak * (Math.sin(x / 8 + y / 13) + 1)) / 2;
      data[p + 2] = (peak * y) / height;
      data[p + 3] = alpha ? ((x + 3 * y) % 11) / 10 : 1;
    }
  }
  return { width, height, data, linearColorSpace: 'linear-rec709' };
}

function error(a: Float32Array, b: Float32Array): { max: number; rmse: number } {
  let max = 0,
    mse = 0;
  for (let i = 0; i < a.length; i++) {
    if ((i & 3) === 3) continue;
    const d = a[i] - b[i];
    max = Math.max(max, Math.abs(d));
    mse += d * d;
  }
  return { max, rmse: Math.sqrt(mse / ((a.length * 3) / 4)) };
}

function pfm(bytes: Uint8Array): Float32Array {
  const m = /^PF\s+(\d+)\s+(\d+)\s+(-?[\d.]+)\s/.exec(new TextDecoder().decode(bytes.subarray(0, 64)))!;
  const width = Number(m[1]),
    height = Number(m[2]);
  const view = new DataView(bytes.buffer, bytes.byteOffset + m[0].length);
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      for (let c = 0; c < 3; c++)
        data[p + c] = view.getFloat32(((height - y - 1) * width * 3 + x * 3 + c) * 4, Number(m[3]) < 0);
      data[p + 3] = 1;
    }
  return data;
}

const hasDjxl = spawnSync('djxl', ['--version']).status === 0;

describe('lossy DCT8 JPEG XL', () => {
  it.runIf(process.env.JXL_VARDCT_CRAFT_OUT)('writes the native VarDCT oracle fixture', () => {
    const output = process.env.JXL_VARDCT_CRAFT_OUT;
    if (!output) throw new Error('JXL_VARDCT_CRAFT_OUT is required to generate the oracle');
    writeFileSync(
      join(output, 'native_dct8_hdr.jxl'),
      writeJxl(pattern(19, 7, true, 100), { lossy: true, distance: 0.5 }),
    );
  });

  it('matches a committed djxl oracle without requiring external tools', () => {
    const bytes = writeJxl(pattern(19, 7, true, 100), { lossy: true, distance: 0.5 });
    const reference = pfm(
      readFileSync(new URL('../../../../assets/jxl/features/native_dct8_hdr.ref.pfm', import.meta.url)),
    );
    expect(error(reference, readJxl(bytes).data).max).toBeLessThan(0.002);
  });

  for (const [width, height] of [
    [1, 1],
    [1, 17],
    [17, 5],
    [128, 80],
    [257, 261],
    [2051, 3],
  ]) {
    it(`${width}x${height}: writes XYB VarDCT with HDR range and bounded linear error`, () => {
      const image = pattern(width, height);
      const encoded = writeJxl(image, { lossy: true });
      const br = new JxlBitReader(encoded);
      const header = readImageHeader(br);
      expect(header.xybEncoded).toBe(true);
      expect(readFrameHeader(br, header).encoding).toBe('vardct');
      const got = readJxl(encoded);
      expect([got.width, got.height]).toEqual([width, height]);
      expect(error(image.data, got.data).max).toBeLessThan(0.3);
      expect(error(image.data, got.data).rmse).toBeLessThan(0.06);
    });
  }

  it('lower distance retains detail, at a larger encoded size', () => {
    const image = pattern(129, 67);
    const fine = writeJxl(image, { lossy: true, distance: 0.25 });
    const coarse = writeJxl(image, { lossy: true, distance: 4 });
    expect(fine.length).toBeGreaterThan(coarse.length);
    expect(error(image.data, readJxl(fine).data).rmse).toBeLessThan(error(image.data, readJxl(coarse).data).rmse);
  });

  for (const bitDepth of ['float16', 'float32', 'uint8', 'uint16'] as const) {
    it(`${bitDepth}: alpha is independently lossless across groups`, () => {
      for (const width of [19, 270]) {
        const image = pattern(width, 23, true);
        const got = readJxl(writeJxl(image, { lossy: true, bitDepth, container: true }));
        for (let i = 3; i < got.data.length; i += 4) {
          const want =
            bitDepth === 'float32'
              ? image.data[i]
              : bitDepth === 'float16'
                ? decodeFloat16(encodeFloat16(image.data[i]))
                : Math.round(image.data[i] * (bitDepth === 'uint8' ? 255 : 65535)) /
                  (bitDepth === 'uint8' ? 255 : 65535);
          expect(got.data[i]).toBeCloseTo(want, 6);
        }
      }
    });
  }

  for (const linearColorSpace of ['linear-p3', 'linear-rec2020'] as const) {
    it(`${linearColorSpace}: transforms wide gamut input to standard XYB`, () => {
      const image = { ...pattern(19, 7), linearColorSpace };
      const expected = convertLinearColorSpace(image, 'linear-rec709');
      const got = readJxl(writeJxl(image, { lossy: true, distance: 0.25 }));
      expect(got.linearColorSpace).toBe('linear-rec709');
      expect(error(expected.data, got.data).rmse).toBeLessThan(0.02);
    });
  }

  it.skipIf(!hasDjxl || spawnSync('cjxl', ['--version']).status !== 0)(
    'documents the size factor against cjxl -e 3 at distance 1',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'hdrify-vardct-size-'));
      try {
        for (const name of ['example_halfs.exr', 'reference_gradient.exr', 'memorial.exr']) {
          const image = readExr(readFileSync(new URL(`../../../../assets/${name}`, import.meta.url)));
          const input = join(dir, 'input.exr'),
            output = join(dir, 'reference.jxl');
          writeFileSync(input, writeExr(image));
          const result = spawnSync('cjxl', [input, output, '-e', '3', '-d', '1'], { encoding: 'utf8' });
          expect(result.status, result.stderr).toBe(0);
          expect(writeJxl(image, { lossy: true }).length).toBeLessThan(readFileSync(output).length * 7);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('integer source formats clamp HDR RGB before lossy quantization', () => {
    const source = pattern(31, 17);
    const encoded = writeJxl(source, { lossy: true, bitDepth: 'uint8', distance: 0.1 });
    const expected = Float32Array.from(source.data, (v) => Math.round(Math.max(0, Math.min(1, v)) * 255) / 255);
    expect(error(expected, readJxl(encoded).data).max).toBeLessThan(0.03);
  });

  it('rejects invalid distance and coefficient overflow', () => {
    for (const distance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 26]) {
      expect(() => writeJxl(pattern(1, 1), { lossy: true, distance })).toThrow(/distance/);
    }
    expect(() => writeJxl(pattern(2, 2), { lossy: true, groupSizeShift: 0 })).toThrow(/groupSizeShift/);
    const image = pattern(2, 2);
    image.data[0] = 3.4e38;
    expect(() => writeJxl(image, { lossy: true })).toThrow(/coefficient range/);
  });

  it.skipIf(!hasDjxl)('djxl decodes HDR, partial groups and alpha with matching RGB values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hdrify-vardct-'));
    try {
      for (const [width, height] of [
        [1, 17],
        [17, 5],
        [270, 31],
        [2051, 3],
      ]) {
        const image = pattern(width, height, true, 100);
        const bytes = writeJxl(image, { lossy: true, distance: 0.5 });
        const input = join(dir, 'image.jxl'),
          output = join(dir, 'image.pfm');
        writeFileSync(input, bytes);
        const decoded = spawnSync('djxl', [input, output], { encoding: 'utf8' });
        expect(decoded.status, decoded.stderr).toBe(0);
        const oracle = pfm(readFileSync(output));
        expect(error(oracle, readJxl(bytes).data).max).toBeLessThan(0.002);
        expect(error(image.data, oracle).rmse).toBeLessThan(0.3);
        const exr = join(dir, 'image.exr');
        expect(spawnSync('djxl', [input, exr]).status).toBe(0);
        const withAlpha = readExr(readFileSync(exr));
        for (let i = 3; i < image.data.length; i += 4)
          expect(withAlpha.data[i]).toBe(decodeFloat16(encodeFloat16(image.data[i])));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
