# Releasing

Releases are manual and maintainer-only. Merging to `main` never publishes.

## Running a Release

```sh
gh workflow run release.yml --ref main                  # release
gh workflow run release.yml --ref main -f dry_run=true  # preview only, publishes nothing
```

When there are no release-worthy commits since the last `v*` tag, the run is a no-op.

## What the Workflow Does

1. Refuses any ref other than `main`.
2. Runs the full CI workflow on the dispatched commit.
3. Stops if `main` has moved since the dispatch.
4. Installs, builds, and runs `pnpm release`, which is semantic-release.
5. semantic-release computes the next version, creates the `v<version>` tag and GitHub Release, and publishes.

Releases run one at a time and never cancel a publish in progress. npm packages publish through npm trusted publishing (GitHub OIDC), so no `NPM_TOKEN` is stored.

## Versioning

The version comes from the Conventional Commits since the last `v*` tag. The highest change wins:

- `feat` produces a minor release.
- `fix` and `perf` produce a patch release.
- `!` or a `BREAKING CHANGE:` footer produces a major release.
- Other types do not trigger a release.

Everything this repository publishes shares one version. `package.json` versions in source are development snapshots; the Git tag and the registry hold the released version. [GitHub Releases](https://github.com/bhouston/hdrify/releases) is the changelog of record.

## One-Time Setup

1. On npmjs.com, open each package's Trusted Publisher settings, choose GitHub Actions, and enter organization or user `bhouston`, repository `hdrify`, workflow filename `release.yml`, and environment name `npm`.
2. Protect `main`: require pull requests and the CI checks, allow merge commits, and block force pushes and deletion.
3. If the repository uploads coverage to Codecov, add the `CODECOV_TOKEN` repository secret.

## Recovery

Publishing is not atomic. If a run fails part way, compare the registry versions, the `v<version>` tag, and the workflow log, then finish what is missing from the same release commit. If publishing succeeded but the GitHub Release failed, create the release from the existing tag. Never republish a version, delete a published version, or move a release tag. Resolve the failure before dispatching another release.

## Repository Specifics

### Published Artifacts

- npm: `hdrify-icc`, `hdrify`, `hdrify-cli`, and `hdrify-react`, published in that order with `pnpm publish`. Each GitHub Release attaches their tarballs.
- VS Code Marketplace and Open VSX: `hdrify-vscode-extension` (`packages/hdrify-vscode-extension`), published by `benhouston3d`.

Add each npm package's Trusted Publisher in One-Time Setup step 1.

### VS Code Extension

The extension shares the release version, which `release.config.js` pins in its `package.json`, but it is never published to npm. `scripts/release-vscode-extension.mjs` builds it, packages it with `vsce`, and publishes it to both registries. Add these repository secrets:

- `VSCE_PAT`: Azure DevOps personal access token for the `benhouston3d` publisher.
- `OVSX_PAT`: Open VSX access token.

### Website

After a real release (not a dry run), the `website` job calls `pages.yml` to deploy the documentation and demo to GitHub Pages from the new `v*` tag.

### Required Checks

`main` requires the `ci` and `contribution` checks.

### Local Validation

- `pnpm release:check` tests commit analysis and each npm package's publish readiness (a `LICENSE` and a `files` field that ships `dist`).
- After `pnpm build`, run `pnpm pack --dry-run` in `packages/icc`, `packages/hdrify`, `packages/cli`, and `packages/hdrify-react` to inspect tarball contents.
