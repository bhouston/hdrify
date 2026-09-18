# Releases

## Running a release

Releases are never triggered by pushes or merges to `main`. When ready to publish, the maintainer dispatches the workflow:

```sh
gh workflow run release.yml --ref main
```

Add `-f dry_run=true` to validate versioning, the changelog, and staged packages without publishing or tagging. The workflow refuses to run against any ref other than `main`. If there are no release-worthy commits since the last tag, the run succeeds as a no-op and says so in the run summary.

## One-time activation

The workflow is installed in `.github/workflows/release.yml`. Publishing is disabled until the repository Actions variable `NPM_RELEASE_ENABLED` is set to `true`.

1. On npmjs.com, open Settings → Trusted Publisher for **each** package: `hdrify`, `hdrify-cli`, and `hdrify-react`. Select GitHub Actions and enter:

   | Field                | Value         |
   | -------------------- | ------------- |
   | Organization or user | `bhouston`    |
   | Repository           | `hdrify`      |
   | Workflow filename    | `release.yml` |
   | Environment name     | Leave blank   |

   These are package settings, not repository secrets. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` is needed. The release job publishes with `pnpm` (pinned to `packageManager` in `package.json`, ≥11.1.3 for reliable OIDC publishing in GitHub Actions) with `id-token: write`; npm supplies automatic provenance for trusted-publisher packages. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

2. The existing release baseline was created during setup. For reference, the bootstrap commands are below; do not rerun them when the tag already exists. The migration baseline is `v1.1.4` at `ff4c3bef6f058a6232749806c1e20d52dd623671`, the main commit at setup; npm already contains hdrify and hdrify-cli 1.1.4 and hdrify-react 1.1.3. This is a version floor for the shared release series, not a claim that hdrify-react 1.1.4 was published. Never move this tag after activation.

   ```sh
   git tag v1.1.4 ff4c3bef6f058a6232749806c1e20d52dd623671
   git push origin v1.1.4
   ```

3. `main` is protected: PRs, up-to-date `ci` and `contribution` checks, and resolved conversations are required, including for administrators. Force pushes and deletion are disabled. Review approval count is zero to support a solo maintainer. Merge commits are enabled; linear history is not required. `main` is the default branch so GitHub closes delivered issues on merge. `dev` predates this workflow, is no longer targeted by contributor PRs or CI, and is kept around unused rather than deleted.
4. Configure the npm publishers before activation, then set `gh variable set NPM_RELEASE_ENABLED --body true`. Dispatch `Release` on `main` (see above) when ready to publish.
5. Configure the repository `CODECOV_TOKEN` secret from Codecov for reliable coverage publishing. Coverage thresholds themselves do not depend on Codecov.

## Versioning and artifacts

Semantic-release analyzes Conventional Commits since the last `v*` tag. `feat` produces a minor, `fix`/`perf` a patch, and `!` or `BREAKING CHANGE:` a major. The highest change wins. A docs/chore-only integration produces no npm release.

`hdrify`, `hdrify-cli`, and `hdrify-react` share one version and publish in dependency order via `pnpm publish` (through `@anolilab/semantic-release-pnpm`, one plugin instance per package), which updates each `package.json` version and rewrites any `workspace:*` internal dependency to a resolved semver range natively. The website and VS Code Marketplace extension retain their existing delivery paths. Source package versions are development snapshots; the authoritative released version is the Git tag/npm version. Each package's `files` field ships built JS and declarations, and npm/pnpm packing conventions include the package's own README and LICENSE automatically. It does not write version commits to protected branches.

Each GitHub Release contains generated release notes, a `CHANGELOG.md` for that release, and all three npm tarballs. [GitHub Releases](https://github.com/bhouston/hdrify/releases) is the cumulative changelog. The generated file is not committed back to source.

The release job waits for the complete reusable CI suite and only runs from a manual dispatch against `main`. Releases are serialized and never cancel an in-progress publish.

## Validation and recovery

`pnpm release:check` tests release analysis and each package's publish readiness (a real LICENSE and a `files` field that ships `dist`) without publishing. Dispatching `release.yml` with `dry_run=true` runs the full workflow — including CI — and previews what semantic-release would do, without publishing or tagging. After building, inspect tarball contents with `pnpm pack --dry-run` in each package directory (`packages/hdrify`, `packages/cli`, `packages/hdrify-react`).

npm publication across three packages is not atomic. If a release fails after publishing one package, inspect npm, the tag, and the workflow log before retrying. Do not delete published versions or blindly remove tags. Finish missing packages from the exact release commit through trusted CI, then complete the GitHub Release. Resolve failures before dispatching another release.

## Reusing the standard

After a successful real release, extract CONTRIBUTING.md, SECURITY.md, the agent pointers, templates, commitlint/Husky setup, CI, and release configuration into a dedicated template repository. Keep each repository’s own LICENSE. Adapt repository names, package paths, version baseline, coverage and bundle budgets, then install matching dependencies. This monorepo’s package staging and cloud deployment configuration are repository-specific; copying them unchanged into other projects is not appropriate.
