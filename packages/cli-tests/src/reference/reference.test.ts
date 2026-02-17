import * as fs from 'node:fs';
import * as path from 'node:path';
import { readExr } from 'hdrify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir, runCli } from '../test-utils/cliTestEnv.js';
import { validateExrOutput, validateHdrOutput } from '../test-utils/validateOutput.js';

function toUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe('CLI reference command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('creates valid .exr file with correct dimensions', async () => {
    const output = path.join(tempDir, 'test.exr');
    const result = runCli(['reference', output, '--width', '16', '--height', '8']);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const meta = await validateExrOutput(output);
    expect(meta.width).toBe(16);
    expect(meta.height).toBe(8);
  });

  it('creates valid .hdr file with correct dimensions', async () => {
    const output = path.join(tempDir, 'test.hdr');
    const result = runCli(['reference', output, '--width', '32', '--height', '16']);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const meta = await validateHdrOutput(output);
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(16);
  });

  it('rejects unsupported extensions', () => {
    const output = path.join(tempDir, 'test.png');
    const result = runCli(['reference', output, '--width', '16', '--height', '16']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unsupported output format');
  });

  it('accepts --value and --intensity options', async () => {
    const output = path.join(tempDir, 'test.hdr');
    const result = runCli(['reference', output, '--width', '8', '--height', '8', '--value', '0.5', '--intensity', '2']);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const meta = await validateHdrOutput(output);
    expect(meta.width).toBe(8);
    expect(meta.height).toBe(8);
  });

  it('creates EXR with default zip compression when --compression not specified', async () => {
    const output = path.join(tempDir, 'test.exr');
    const result = runCli(['reference', output, '--width', '8', '--height', '8']);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const meta = await validateExrOutput(output);
    expect(meta.width).toBe(8);
    expect(meta.height).toBe(8);
    expect(meta.compression).toBe('ZIP');
  });

  it('creates EXR with --compression rle', async () => {
    const output = path.join(tempDir, 'test.exr');
    const result = runCli(['reference', output, '--width', '8', '--height', '8', '--compression', 'rle']);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const meta = await validateExrOutput(output);
    expect(meta.width).toBe(8);
    expect(meta.height).toBe(8);
    expect(meta.compression).toBe('RLE');
  });

  it('creates EXR with --compression zip', async () => {
    const output = path.join(tempDir, 'test.exr');
    const result = runCli(['reference', output, '--width', '8', '--height', '8', '--compression', 'zip']);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const meta = await validateExrOutput(output);
    expect(meta.width).toBe(8);
    expect(meta.height).toBe(8);
    expect(meta.compression).toBe('ZIP');
  });

  it('creates EXR with --compression pxr24', async () => {
    const output = path.join(tempDir, 'test.exr');
    const result = runCli(['reference', output, '--width', '16', '--height', '8', '--compression', 'pxr24']);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const meta = await validateExrOutput(output);
    expect(meta.width).toBe(16);
    expect(meta.height).toBe(8);
    expect(meta.compression).toBe('PXR24');
  });

  it('rejects --compression when output is HDR', () => {
    const output = path.join(tempDir, 'test.hdr');
    const result = runCli(['reference', output, '--compression', 'rle']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--compression is only valid for EXR output');
  });

  describe('cie-wedge type', () => {
    it('creates valid EXR with Rec 2020 chromaticities', async () => {
      const output = path.join(tempDir, 'cie.exr');
      const result = runCli(['reference', output, '--type', 'cie-wedge']);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateExrOutput(output);
      expect(meta.width).toBe(512);
      expect(meta.height).toBe(512);

      const data = readExr(toUint8Array(fs.readFileSync(output)));
      expect(data.linearColorSpace).toBe('linear-rec2020');
    });

    it('creates valid HDR (linear sRGB)', async () => {
      const output = path.join(tempDir, 'cie.hdr');
      const result = runCli(['reference', output, '--type', 'cie-wedge']);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateHdrOutput(output);
      expect(meta.width).toBe(512);
      expect(meta.height).toBe(512);
    });

    it('respects --width and --height override', async () => {
      const output = path.join(tempDir, 'cie.exr');
      const result = runCli(['reference', output, '--type', 'cie-wedge', '--width', '64', '--height', '32']);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateExrOutput(output);
      expect(meta.width).toBe(64);
      expect(meta.height).toBe(32);
    });
  });

  describe('gradient type', () => {
    it('creates valid EXR with default 512x512', async () => {
      const output = path.join(tempDir, 'grad.exr');
      const result = runCli(['reference', output, '--type', 'gradient']);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateExrOutput(output);
      expect(meta.width).toBe(512);
      expect(meta.height).toBe(512);
    });

    it('creates valid HDR', async () => {
      const output = path.join(tempDir, 'grad.hdr');
      const result = runCli(['reference', output, '--type', 'gradient']);

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(output)).toBe(true);
      const meta = await validateHdrOutput(output);
      expect(meta.width).toBe(512);
      expect(meta.height).toBe(512);
    });
  });
});
