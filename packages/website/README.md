# HDRify live demo

The existing viewer/converter is retained as a static Vite and React app, published with the Docusaurus site at https://bhouston.github.io/hdrify/demo/.

It supports drag-and-drop and file selection, sample images, exposure/tone mapping controls, metadata, and EXR/HDR/Ultra HDR/WebP downloads. Files are processed locally using hdrify and hdrify-react. The canvas uses the 2D API.

From the repository root, run `pnpm install`, `pnpm --filter hdrify --filter hdrify-react build`, then `pnpm --filter website dev`. Open http://localhost:3000/hdrify/demo/. `pnpm docs:build` builds the libraries, demo, and documentation together.

`BASE_URL` defaults to `/hdrify/`; set it to `/` consistently for all builds to host at a domain root. The original Cloud Run deployment now serves a redirect to GitHub Pages, preserving old `?image=` links and example image URLs. GitHub Pages serves the actual site and live demo from a Pages artifact; no application server is needed there.
