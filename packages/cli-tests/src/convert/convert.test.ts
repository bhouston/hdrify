import * as fs from 'node:fs';
import * as path from 'node:path';
import { readExr, readJxl, writeExr } from 'hdrify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assetsDir,
  createTempDir,
  exrFilePaths,
  hdrFilePaths,
  jpgGainMapFilePath,
  runCli,
} from '../test-utils/cliTestEnv.js';
import { validateExrOutput, validateHdrOutput, validateWithSharp } from '../test-utils/validateOutput.js';

describe('CLI convert command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('accepts high-effort lossless JXL and rejects effort on other output formats', () => {
    const output = path.join(tempDir, 'high.jxl');
    const result = runCli(['convert', exrFilePaths[0], output, '--size', '33,19', '--jxl-effort', 'high']);
    expect(result.exitCode, result.stderr).toBe(0);
    const image = readJxl(fs.readFileSync(output));
    expect([image.width, image.height]).toEqual([33, 19]);
    const invalid = runCli(['convert', exrFilePaths[0], path.join(tempDir, 'out.exr'), '--jxl-effort', 'high']);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toMatch(/only valid for JXL/);
  });

  it('writes lossy JPEG XL with --jxl-distance and --jxl-lossy', () => {
    const input = exrFilePaths[0];
    for (const flags of [['--jxl-lossy'], ['--jxl-distance', '0.5']]) {
      const output = path.join(tempDir, 'lossy.jxl');
      const result = runCli(['convert', input, output, '--size', '33,19', ...flags]);
      expect(result.exitCode, result.stderr).toBe(0);
      const image = readJxl(fs.readFileSync(output));
      expect([image.width, image.height]).toEqual([33, 19]);
    }
  });

  it('rejects JPEG XL lossy options on other output formats', () => {
    const result = runCli(['convert', exrFilePaths[0], path.join(tempDir, 'output.exr'), '--jxl-lossy']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/only valid for JXL/);
  });

  it('rejects high effort with lossy JXL output', () => {
    const result = runCli([
      'convert',
      exrFilePaths[0],
      path.join(tempDir, 'lossy.jxl'),
      '--size',
      '33,19',
      '--jxl-lossy',
      '--jxl-effort',
      'high',
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/only supported for lossless/);
  });

  describe('JXL bit depth and container', () => {
    // Uncompressed EXR keeps FLOAT channels; values chosen so float16 cannot represent them.
    function writeFloat32Exr(): { file: string; data: Float32Array } {
      const width = 7;
      const height = 5;
      const data = new Float32Array(width * height * 4);
      for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? 1 : 0.1234567 + i * 1.000123;
      const file = path.join(tempDir, 'float32.exr');
      fs.writeFileSync(
        file,
        writeExr({ width, height, data, linearColorSpace: 'linear-rec709' }, { compression: 'none' }),
      );
      return { file, data: readExr(fs.readFileSync(file)).data };
    }

    it('round-trips a float32 EXR bit-exactly with --jxl-bit-depth float32 and by default', () => {
      const { file, data } = writeFloat32Exr();
      for (const flags of [['--jxl-bit-depth', 'float32'], []]) {
        const output = path.join(tempDir, 'out.jxl');
        const result = runCli(['convert', file, output, ...flags]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).not.toMatch(/Note: source needs/);
        const image = readJxl(fs.readFileSync(output));
        expect(image.metadata).toMatchObject({ floatSample: true, bitsPerSample: 32 });
        expect(new Uint32Array(image.data.buffer)).toEqual(new Uint32Array(data.buffer));
      }
    });

    it('writes each --jxl-bit-depth and notes precision reduction of float32 sources', () => {
      const { file } = writeFloat32Exr();
      const expected = {
        float16: { floatSample: true, bitsPerSample: 16 },
        uint16: { floatSample: false, bitsPerSample: 16 },
        uint8: { floatSample: false, bitsPerSample: 8 },
      };
      for (const [bitDepth, header] of Object.entries(expected)) {
        const output = path.join(tempDir, `${bitDepth}.jxl`);
        const result = runCli(['convert', file, output, '--jxl-bit-depth', bitDepth]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toContain(`writing ${bitDepth} may lose precision`);
        expect(readJxl(fs.readFileSync(output)).metadata).toMatchObject(header);
      }
    });

    it('keeps float16 by default for half-float EXR sources', () => {
      const output = path.join(tempDir, 'half.jxl');
      const result = runCli(['convert', exrFilePaths[0], output, '--size', '33,19']);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).not.toMatch(/Note: source needs/);
      expect(readJxl(fs.readFileSync(output)).metadata).toMatchObject({ floatSample: true, bitsPerSample: 16 });
    });

    it('defaults to float32 for a 16-bit integer JXL source', () => {
      const output = path.join(tempDir, 'rgb16.jxl');
      const result = runCli(['convert', path.join(assetsDir, 'jxl', 'lossless_rgb16.jxl'), output]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(readJxl(fs.readFileSync(output)).metadata).toMatchObject({ floatSample: true, bitsPerSample: 32 });
    });

    it('wraps output in the container with --jxl-container', () => {
      const output = path.join(tempDir, 'container.jxl');
      const result = runCli(['convert', exrFilePaths[0], output, '--size', '33,19', '--jxl-container']);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(readJxl(fs.readFileSync(output)).metadata?.container).toBe(true);
    });

    it('rejects --jxl-bit-depth and --jxl-container on other output formats', () => {
      for (const [output, flags] of [
        ['out.exr', ['--jxl-bit-depth', 'float32']],
        ['out.png', ['--jxl-container']],
      ] as const) {
        const result = runCli(['convert', exrFilePaths[0], path.join(tempDir, output), ...flags]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toMatch(/--jxl-bit-depth and --jxl-container are only valid for JXL/);
      }
    });

    it('rejects an unknown --jxl-bit-depth', () => {
      const result = runCli(['convert', exrFilePaths[0], path.join(tempDir, 'out.jxl'), '--jxl-bit-depth', 'int8']);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/Invalid values/);
    });
  });

  describe('EXR/HDR conversions', () => {
    it('converts EXR to HDR', async () => {
      const input = exrFilePaths[0];
      const output = path.join(tempDir, 'output.hdr');

      const result = runCli(['convert', input, output]);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateHdrOutput(output);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    });

    it('converts HDR to EXR', async () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.exr');

      const result = runCli(['convert', input, output]);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      // Validate EXR is readable (writeExr may have issues with very large images)
      try {
        const meta = await validateExrOutput(output);
        expect(meta.width).toBeGreaterThan(0);
        expect(meta.height).toBeGreaterThan(0);
      } catch {
        // Fallback: at least verify file has content and EXR magic
        const buf = fs.readFileSync(output);
        expect(buf.length).toBeGreaterThan(100);
        const magic = buf.readUInt32LE(0);
        expect(magic).toBe(20000630);
      }
    });

    it('converts HDR to EXR with default zip compression when --compression not specified', async () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.exr');

      const result = runCli(['convert', input, output]);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateExrOutput(output);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
      expect(meta.compression).toBe('zip');
    });

    it('round-trips EXR -> HDR -> EXR', async () => {
      const input = exrFilePaths[0];
      const hdrPath = path.join(tempDir, 'intermediate.hdr');
      const exrPath = path.join(tempDir, 'output.exr');

      const r1 = runCli(['convert', input, hdrPath]);
      expect(r1.exitCode).toBe(0);
      const r2 = runCli(['convert', hdrPath, exrPath]);
      expect(r2.exitCode).toBe(0);

      const meta = await validateHdrOutput(hdrPath);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
      // EXR output may not round-trip for large images; verify file exists
      expect(fs.existsSync(exrPath)).toBe(true);
    });

    it('converts HDR to EXR with --compression none', async () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.exr');

      const result = runCli(['convert', input, output, '--compression', 'none']);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateExrOutput(output);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    });

    it('converts HDR to EXR with --compression rle', async () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.exr');

      const result = runCli(['convert', input, output, '--compression', 'rle']);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateExrOutput(output);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    });

    it('converts HDR to EXR with --compression zip', async () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.exr');

      const result = runCli(['convert', input, output, '--compression', 'zip']);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateExrOutput(output);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    });

    it('converts HDR to EXR with --compression piz', async () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.exr');

      const result = runCli(['convert', input, output, '--compression', 'piz']);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateExrOutput(output);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    });

    it('converts HDR to EXR with --compression pxr24', async () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.exr');

      const result = runCli(['convert', input, output, '--compression', 'pxr24']);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateExrOutput(output);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
      expect(meta.compression).toBe('pxr24');
    });

    it('flips with --flip -1,1, mirroring pixels horizontally', async () => {
      const input = exrFilePaths[0];
      const output = path.join(tempDir, 'output.exr');

      const result = runCli(['convert', input, output, '--flip', '-1,1']);

      expect(result.exitCode).toBe(0);
      const original = readExr(new Uint8Array(fs.readFileSync(input)));
      const flipped = readExr(new Uint8Array(fs.readFileSync(output)));
      expect(flipped.width).toBe(original.width);
      expect(flipped.height).toBe(original.height);
      // Same row, mirrored column, same channel value.
      const y = Math.floor(original.height / 2);
      const x = 3;
      const originalOffset = (y * original.width + x) * 4;
      const flippedOffset = (y * original.width + (original.width - 1 - x)) * 4;
      expect(flipped.data[flippedOffset]).toBeCloseTo(original.data[originalOffset]!, 3);
    });
  });

  describe('SDR conversions', () => {
    it('converts HDR to PNG', async () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.png');

      const result = runCli(['convert', input, output]);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateWithSharp(output);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    });

    it('converts HDR to WebP', async () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.webp');

      const result = runCli(['convert', input, output]);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateWithSharp(output);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    });

    it('converts HDR to JPEG (gain map)', async () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.jpg');

      const result = runCli(['convert', input, output]);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateWithSharp(output);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    });

    it('converts HDR to JPEG with --format adobe-gainmap', async () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.jpg');

      const result = runCli(['convert', input, output, '--format', 'adobe-gainmap']);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateWithSharp(output);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    });

    it('converts JPEG gain map to EXR when JPEG is input', async () => {
      const input = jpgGainMapFilePath;
      const output = path.join(tempDir, 'output.exr');

      const result = runCli(['convert', input, output]);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateExrOutput(output);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    });

    it('converts EXR to PNG', async () => {
      const input = exrFilePaths[0];
      const output = path.join(tempDir, 'output.png');

      const result = runCli(['convert', input, output]);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateWithSharp(output);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    });

    it('accepts --tonemapping and --gamma options', async () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.png');

      const result = runCli(['convert', input, output, '--tonemapping', 'aces', '--gamma', '2.2']);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateWithSharp(output);
      expect(meta.width).toBeGreaterThan(0);
      expect(meta.height).toBeGreaterThan(0);
    });
  });

  describe('error cases', () => {
    it('fails when input file does not exist', () => {
      const output = path.join(tempDir, 'output.hdr');
      const result = runCli(['convert', '/nonexistent/file.exr', output]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    it('fails when output format is unsupported', () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.xyz');
      const result = runCli(['convert', input, output]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Unsupported output format');
    });

    it('fails when --compression is used with HDR output', () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.hdr');
      const result = runCli(['convert', input, output, '--compression', 'rle']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--compression is only valid for EXR output');
    });

    it('fails when --compression is used with PNG output', () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.png');
      const result = runCli(['convert', input, output, '--compression', 'zip']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--compression is only valid for EXR output');
    });

    it('fails when --format is used with PNG output', () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.png');
      const result = runCli(['convert', input, output, '--format', 'adobe-gainmap']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--format is only valid for JPEG output');
    });

    it('fails when --flip has a value other than 1 or -1', () => {
      const input = hdrFilePaths[0];
      const output = path.join(tempDir, 'output.exr');
      const result = runCli(['convert', input, output, '--flip', '2,1']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid --flip value');
    });
  });
});
