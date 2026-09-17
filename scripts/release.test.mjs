import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { packages, stagePackages } from './release-packages.mjs';
import { checkPullRequest } from './check-pr.mjs';

const logger = { log() {} };
for (const [message, expected] of [
  ['feat: add batch conversion', 'minor'],
  ['fix(exr): handle empty input', 'patch'],
  ['perf: reduce allocations', 'patch'],
  ['docs: clarify usage', null],
  ['chore: update tooling', null],
  ['feat!: remove legacy reader', 'major'],
  ['chore!: remove Node 24 support', 'major'],
  ['fix: change format\n\nBREAKING CHANGE: old files are unsupported', 'major'],
]) {
  test(`release analysis: ${message.split('\n')[0]}`, async () => {
    assert.equal(
      await analyzeCommits(
        { preset: 'conventionalcommits' },
        { cwd: process.cwd(), commits: [{ hash: 'abc', message }], logger },
      ),
      expected,
    );
  });
}

test('stage all packages at one version with installable dependencies and license', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hdrify-release-'));
  try {
    writeFileSync(join(cwd, 'LICENSE'), 'MIT');
    for (const [index, path] of packages.entries()) {
      mkdirSync(join(cwd, path, 'dist'), { recursive: true });
      writeFileSync(join(cwd, path, 'dist/index.js'), 'export {};');
      writeFileSync(join(cwd, path, 'dist/index.test.js'), 'test fixture');
      writeFileSync(join(cwd, path, 'dist/index.d.ts'), 'export {};');
      writeFileSync(join(cwd, path, 'README.md'), 'Readme');
      writeFileSync(
        join(cwd, path, 'package.json'),
        JSON.stringify({
          name: ['hdrify', 'hdrify-cli', 'hdrify-react'][index],
          version: '1.1.3',
          scripts: { prepare: 'false' },
          dependencies: index ? { hdrify: 'workspace:*' } : { fflate: '^0.8.2' },
        }),
      );
    }
    stagePackages(cwd, '2.0.0');
    for (const [index, path] of packages.entries()) {
      const pkg = JSON.parse(readFileSync(join(cwd, path, 'publish/package.json')));
      assert.equal(pkg.version, '2.0.0');
      assert.equal(existsSync(join(cwd, path, 'publish/dist/index.test.js')), false);
      assert.equal(pkg.scripts, undefined);
      assert.equal(pkg.dependencies[index ? 'hdrify' : 'fflate'], index ? '^2.0.0' : '^0.8.2');
      assert.equal(readFileSync(join(cwd, path, 'publish/LICENSE'), 'utf8'), 'MIT');
      assert.ok(readFileSync(join(cwd, path, 'publish/dist/index.d.ts'), 'utf8'));
      assert.equal(JSON.parse(readFileSync(join(cwd, path, 'package.json'))).version, '1.1.3');
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('PR policy enforces issue, branch, and integration target', () => {
  const pr = {
    base: { ref: 'main' },
    head: { ref: 'feature/42-batch-export', repo: { full_name: 'bhouston/hdrify' } },
    body: 'Closes #42',
  };
  assert.doesNotThrow(() => checkPullRequest(pr));
  assert.throws(() => checkPullRequest({ ...pr, body: 'Closes #420' }));
  assert.throws(() => checkPullRequest({ ...pr, base: { ref: 'dev' } }));
  assert.throws(() => checkPullRequest({ ...pr, head: { ...pr.head, ref: 'not-a-valid-branch' } }));
});
