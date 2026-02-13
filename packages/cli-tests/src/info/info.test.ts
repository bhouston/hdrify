import { describe, expect, it } from 'vitest';
import { exrFilePaths, hdrFilePaths, jpgGainMapFilePath, runCli } from '../test-utils/cliTestEnv.js';

describe('CLI info command', () => {
  it('displays info for HDR file (default YAML format)', () => {
    const file = hdrFilePaths[0];
    const result = runCli(['info', file]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('format:');
    expect(result.stdout).toContain('width:');
    expect(result.stdout).toContain('height:');
    expect(result.stdout).toContain('metadata:');
  });

  it('displays info for EXR file including compression and metadata', () => {
    const file = exrFilePaths[0];
    const result = runCli(['info', file]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('format:');
    expect(result.stdout).toContain('width:');
    expect(result.stdout).toContain('height:');
    expect(result.stdout).toContain('compression:');
    expect(result.stdout).toContain('metadata:');
  });

  it('outputs JSON when --format json', () => {
    const file = hdrFilePaths[0];
    const result = runCli(['info', file, '--format', 'json']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.format).toBe('HDR');
    expect(parsed.width).toBeDefined();
    expect(parsed.height).toBeDefined();
    expect(parsed.metadata).toBeDefined();
  });

  it('fails when file does not exist', () => {
    const result = runCli(['info', '/nonexistent/file.exr']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not found');
  });

  it('displays info for JPEG gain map file', () => {
    const result = runCli(['info', jpgGainMapFilePath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('format:');
    expect(result.stdout).toContain('width:');
    expect(result.stdout).toContain('height:');
    expect(result.stdout).toContain('metadata:');
  });
});
