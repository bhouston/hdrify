import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir, runCli } from '../test-utils/cliTestEnv.js';
import { validateExrOutput, validateHdrOutput } from '../test-utils/validateOutput.js';

describe('CLI create-test command', () => {
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
    const result = runCli(['create-test', output, '--width', '16', '--height', '8']);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const meta = await validateExrOutput(output);
    expect(meta.width).toBe(16);
    expect(meta.height).toBe(8);
  });

  it('creates valid .hdr file with correct dimensions', async () => {
    const output = path.join(tempDir, 'test.hdr');
    const result = runCli(['create-test', output, '--width', '32', '--height', '16']);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const meta = await validateHdrOutput(output);
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(16);
  });

  it('rejects unsupported extensions', () => {
    const output = path.join(tempDir, 'test.png');
    const result = runCli(['create-test', output, '--width', '16', '--height', '16']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unsupported output format');
  });

  it('accepts --value and --intensity options', async () => {
    const output = path.join(tempDir, 'test.hdr');
    const result = runCli([
      'create-test',
      output,
      '--width',
      '8',
      '--height',
      '8',
      '--value',
      '0.5',
      '--intensity',
      '2',
    ]);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const meta = await validateHdrOutput(output);
    expect(meta.width).toBe(8);
    expect(meta.height).toBe(8);
  });
});
