import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { checkPullRequest } from './check-pr.mjs';

// Published via pnpm publish directly (see release.config.js): pnpm rewrites
// workspace:* deps and packs the `files` field natively, so these packages
// just need a real LICENSE and a `files` field that ships `dist`.
const packages = ['packages/hdrify', 'packages/cli', 'packages/hdrify-react'];

for (const path of packages) {
  test(`${path} is ready for pnpm publish`, () => {
    assert.ok(existsSync(resolve(path, 'LICENSE')), `${path}/LICENSE is missing`);
    const pkg = JSON.parse(readFileSync(resolve(path, 'package.json'), 'utf8'));
    assert.ok(pkg.files?.includes('dist'), `${path}/package.json files must include "dist"`);
  });
}

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
