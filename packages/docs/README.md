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
