import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// packages/cli-tests/src/test-utils -> 4 levels up = workspace root
const workspaceRoot = path.resolve(__dirname, '../../../..');
const cliPath = path.join(workspaceRoot, 'packages', 'cli', 'dist', 'index.js');
const assetsDir = path.join(workspaceRoot, 'assets');

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the hdrify CLI as a subprocess.
 */
export function runCli(
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
): RunCliResult {
  const result = spawnSync('node', [cliPath, ...args], {
    encoding: 'utf8',
    cwd: opts?.cwd ?? workspaceRoot,
    env: { ...process.env, ...opts?.env },
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? (result.signal ? 1 : 0),
  };
}

/**
 * Create a temporary directory for test output. Caller is responsible for cleanup.
 */
export function createTempDir(): string {
  const dir = path.join(os.tmpdir(), `hdrify-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export { assetsDir, workspaceRoot };
