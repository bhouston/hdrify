# Contributing

These rules apply to every contributor, including Claude and Codex. This file is the single source of truth for the workflow.

## Issue → branch → implementation → PR

1. Before starting a feature or other tracked change, create a GitHub issue using the feature/change template. Include what changes, why, constraints, and testable acceptance criteria. Reuse an existing issue when it already covers the request. With `gh issue create`, include the same sections in the body.
2. Fetch origin and branch from `origin/main`. Use `feature/<issue>-<short-description>` for features; `fix/`, `chore/`, `docs/`, `refactor/`, and `test/` are also accepted. Example: `feature/42-batch-export`.
3. Implement and validate the acceptance criteria. Every commit must use Conventional Commits. Reference the issue in the commit body where useful. Never commit directly to `main`.
4. Run `pnpm build`, `pnpm tsc`, `pnpm lint`, `pnpm test --coverage`, `pnpm release:check`, and `pnpm size`. Run `pnpm audit --audit-level=high` and review findings. Format changed files with `pnpm exec oxfmt <files>`.
5. Push the branch and open a PR against **main**. Give the PR a Conventional Commit title and include `Closes #<issue>`, a description of the resulting behavior, and validation results. Do not merge your own work unless the maintainer requested a merge. PRs are merged with merge commits; do not squash.
6. Merging a PR runs CI but never publishes. The maintainer publishes separately by dispatching the `Release` workflow on `main` (see [RELEASING.md](RELEASING.md)); there is no promotion or sync-back branch to keep aligned.

GitHub automatically closes referenced issues when their closing commits reach the default branch (`main`).

## Commit format and versions

Use `type(optional-scope): description`. Allowed types are `feat`, `fix`, `perf`, `docs`, `chore`, `refactor`, `test`, `style`, `build`, `ci`, and `revert`.

- `feat: add batch conversion` triggers a minor release.
- `fix(exr): handle empty chunks` and `perf:` trigger patch releases.
- `feat!: remove the legacy reader` or a `BREAKING CHANGE: explanation` footer triggers a major release, including when attached to another type.
- Other types do not normally trigger a release. Reverts are interpreted by the release analyzer.

Use an imperative, concise description. Add a blank line before a body or footer. Husky validates commit messages after `pnpm install`; CI validates feature commits and PR titles too. Git-generated merge commits are exempt from commitlint.

Do not manually bump versions or write changelog entries. The three npm packages release together. See [RELEASING.md](RELEASING.md) for the release mechanics and setup.

## Development and CI

Use Node 26 and the pinned pnpm version in `package.json`, then run `pnpm install --frozen-lockfile`.

CI checks builds, types, lint, release tooling tests, bundle budgets, and tests with coverage. The core library coverage floors are 89% statements, 72% branches, 93% functions, and 89% lines. Budgets are in `package.json`; change them only with an explanation in the PR. Dependency audit findings appear as warnings so existing advisories remain visible without preventing unrelated fixes. Coverage is uploaded as an artifact and to Codecov; configure `CODECOV_TOKEN` for reliable uploads and the README badge.

Report vulnerabilities privately using [SECURITY.md](SECURITY.md).
