# HDRify documentation website

Docusaurus documentation and landing page for [bhouston.github.io/hdrify](https://bhouston.github.io/hdrify/). The website combines hand-written guides with API documentation generated from the core and React package exports and source comments. The existing viewer and converter is retained at `/demo/`.

## Content

- `docs/index.md`: installation and first conversion
- `docs/formats.md`: file formats, floating point RGBA, color spaces, and precision
- `docs/examples.md`: Node.js conversions, gain maps, resampling, and browser previews
- `docs/react.md`: a complete React viewer and component props
- `docs/cli.md`: command line conversion, inspection, and reference images

Generated API pages are built from `packages/hdrify/src/index.ts` and `packages/hdrify-react/src/index.ts`. Update the public exports and their TSDoc/JSDoc comments to improve the reference; edit the guide Markdown files for explanations and examples.

Run the documentation scripts from this package or use the root workspace commands. Build from the repository root so workspace dependencies and the live demo are available. The GitHub Pages deployment workflow publishes the generated static site as a Pages artifact.

## CLI documentation

The `@clidoc/docusaurus` plugin generates `/docs/cli/reference/` and its command pages from the OpenCLI document produced by `hdrify docgen`. The documentation prebuild and predev scripts export that document from the built CLI to `.generated/hdrify.opencli.json`; the plugin writes ignored Markdown pages in `docs/generated-cli/` before Docusaurus loads the sidebar. Keep command descriptions/options in `packages/cli/src/commands/`, and practical recipes in `docs/cli.md`.

From the repository root, run `pnpm docs:build` for production output or `pnpm docs:dev` for documentation development. Both build the CLI and its dependencies first. For direct package commands, build the CLI first with `pnpm --filter hdrify-cli... build`.
