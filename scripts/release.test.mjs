import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { checkPullRequest } from './check-pr.mjs';
import { publish as publishExtension } from './release-vscode-extension.mjs';

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

test('VS Code extension publish is skipped (not thrown) when VSCE_PAT/OVSX_PAT are unset', () => {
  const { VSCE_PAT, OVSX_PAT } = process.env;
  delete process.env.VSCE_PAT;
  delete process.env.OVSX_PAT;
  try {
    assert.doesNotThrow(() => publishExtension());
  } finally {
    if (VSCE_PAT !== undefined) process.env.VSCE_PAT = VSCE_PAT;
    if (OVSX_PAT !== undefined) process.env.OVSX_PAT = OVSX_PAT;
  }
});

test('PR policy enforces issue link and integration target, not branch name', () => {
  const pr = {
    base: { ref: 'main' },
    head: { ref: 'whatever-branch-name-i-want', repo: { full_name: 'bhouston/hdrify' } },
    body: 'Closes #42',
  };
  assert.doesNotThrow(() => checkPullRequest(pr));
  assert.throws(() => checkPullRequest({ ...pr, body: 'no issue reference' }));
  assert.throws(() => checkPullRequest({ ...pr, base: { ref: 'dev' } }));
});
