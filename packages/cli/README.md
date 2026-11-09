<p align="center">
  <a href="https://hdrify.ben3d.ca" target="_blank" rel="noopener noreferrer">
    <img alt="hdrify-cli logo" src="https://raw.githubusercontent.com/bhouston/hdrify/main/packages/hdrify-vscode-extension/images/icon.png" height="96">
  </a>
</p>
<br/>
<p align="center">
  <a href="https://npmjs.com/package/hdrify-cli"><img src="https://img.shields.io/npm/v/hdrify-cli.svg" alt="npm package"></a>
  <a href="https://www.npmtrends.com/hdrify-cli"><img src="https://img.shields.io/npm/dw/hdrify-cli.svg" alt="npm downloads"></a>
  <a href="https://codecov.io/gh/bhouston/hdrify"><img src="https://codecov.io/gh/bhouston/hdrify/branch/main/graph/badge.svg" alt="coverage"></a>
  <a href="https://discord.gg/5J5Ur3F6Z2"><img src="https://img.shields.io/badge/chat-discord-blue?style=flat&logo=discord" alt="discord chat"></a>
  <a href="https://hdrify.ben3d.ca"><img src="https://img.shields.io/badge/docs-read-blue?style=flat" alt="documentation"></a>
</p>
<br/>

# hdrify-cli

> Convert and inspect EXR, HDR, and Ultra HDR files from the terminal.

- 🔄 Convert EXR, HDR, and Gain Maps
- 📸 Ultra HDR and Adobe Gain Map Output
- 🔍 Inspect File Metadata
- 📐 Resize and Flip Images
- 🎨 Tone Map to PNG, WebP, JPEG
- 🧪 Generate Reference Test Images

CLI for converting and inspecting EXR, HDR, and JPEG gain map (Ultra HDR / Adobe) files. Convert to highly compressible JPEG-R (JPEG with gain maps) for efficient HDR storage. Powered by [hdrify](https://www.npmjs.com/package/hdrify).

**Related packages:** [hdrify](https://www.npmjs.com/package/hdrify) (core library) · [hdrify-react](https://www.npmjs.com/package/hdrify-react) (React component)

Try the **[online demo](https://hdrify.ben3d.ca/demo/)** — HDR, EXR, and Ultra HDR viewer and converter; try it in your browser without installing the CLI.

## Installation

```sh
pnpm add -g hdrify-cli
```

## Usage

```sh
hdrify convert input.exr output.hdr
hdrify convert input.exr output.jpg  # Ultra HDR JPEG with a gain map
hdrify convert input.exr output.webp  # Tone-mapped SDR preview
hdrify info input.exr
hdrify reference gradient.exr --type gradient
```

Run `hdrify convert --help` for help in your terminal.

## Documentation

Full documentation for the CLI is available [on the HDRify documentation website](https://hdrify.ben3d.ca/docs/cli/), with practical recipes and generated command references in one section.

## Contribution

See [Contributing Guide](https://github.com/bhouston/hdrify/blob/main/CONTRIBUTING.md).

## License

MIT

## Author

[Ben Houston](https://ben3d.ca), Sponsored by [Land of Assets](https://landofassets.com).
