import { packages } from './scripts/release-packages.mjs';

export default {
  branches: ['main'],
  repositoryUrl: 'https://github.com/bhouston/hdrify.git',
  tagFormat: 'v${version}',
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
    './scripts/release-packages.mjs',
    ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
    ...packages.map((path) => [
      '@semantic-release/npm',
      { pkgRoot: `${path}/publish`, tarballDir: 'release-artifacts' },
    ]),
    [
      '@semantic-release/github',
      {
        assets: ['CHANGELOG.md', 'release-artifacts/*.tgz'],
        successComment: false,
        failComment: false,
        releasedLabels: false,
      },
    ],
  ],
};
