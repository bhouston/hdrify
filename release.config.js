// Packages published to npm, in dependency order (hdrify first; cli and
// hdrify-react depend on it via workspace:*, which pnpm publish rewrites
// to a resolved semver range natively).
const packages = ['packages/hdrify', 'packages/cli', 'packages/hdrify-react'];

export default {
  branches: ['main'],
  repositoryUrl: 'https://github.com/bhouston/hdrify.git',
  tagFormat: 'v${version}',
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
    ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
    ...packages.map((path) => ['@anolilab/semantic-release-pnpm', { pkgRoot: path, tarballDir: 'release-artifacts' }]),
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
