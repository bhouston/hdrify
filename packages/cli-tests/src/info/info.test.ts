import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetsDir, runCli } from '../test-utils/cliTestEnv.js';

const hdrFiles = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).filter((f) => f.endsWith('.hdr'))
  : [];
const exrFiles = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).filter((f) => f.endsWith('.exr'))
  : [];

describe('CLI info command', () => {
  it('displays info for HDR file', () => {
    if (hdrFiles.length === 0) return;
    const file = path.join(assetsDir, hdrFiles[0]!);
    const result = runCli(['info', file]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Format:');
    expect(result.stdout).toContain('Width:');
    expect(result.stdout).toContain('Height:');
  });

  it('displays info for EXR file including compression', () => {
    if (exrFiles.length === 0) return;
    const file = path.join(assetsDir, exrFiles[0]!);
    const result = runCli(['info', file]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Format:');
    expect(result.stdout).toContain('Width:');
    expect(result.stdout).toContain('Height:');
    expect(result.stdout).toContain('Compression:');
  });

  it('fails when file does not exist', () => {
    const result = runCli(['info', '/nonexistent/file.exr']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not found');
  });
});
