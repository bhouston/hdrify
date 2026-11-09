<p align="center">
  <a href="https://hdrify.ben3d.ca" target="_blank" rel="noopener noreferrer">
    <img alt="HDRify logo" src="https://raw.githubusercontent.com/bhouston/hdrify/main/packages/hdrify-vscode-extension/images/icon.png" height="96">
  </a>
</p>
<br/>
<p align="center">
  <a href="https://npmjs.com/package/hdrify"><img src="https://img.shields.io/npm/v/hdrify.svg" alt="npm package"></a>
  <a href="https://www.npmtrends.com/hdrify"><img src="https://img.shields.io/npm/dw/hdrify.svg" alt="npm downloads"></a>
  <a href="https://codecov.io/gh/bhouston/hdrify"><img src="https://codecov.io/gh/bhouston/hdrify/branch/main/graph/badge.svg" alt="coverage"></a>
  <a href="https://discord.gg/5J5Ur3F6Z2"><img src="https://img.shields.io/badge/chat-discord-blue?style=flat&logo=discord" alt="discord chat"></a>
  <a href="https://hdrify.ben3d.ca"><img src="https://img.shields.io/badge/docs-read-blue?style=flat" alt="documentation"></a>
</p>
<br/>

# HDRify

> Read and write EXR, HDR, and Ultra HDR images in pure JavaScript.

- 📦 Pure JavaScript, No Native Bindings
- 🌐 Node.js, Browsers, and Web Workers
- 🗜️ All Major EXR Compressions
- 📸 Adobe and Ultra HDR Gain Maps
- 🎨 Four Built-in Tone Mappers
- 🔷 Full TypeScript Support

HDRify reads and writes HDR (Radiance RGBE), EXR (OpenEXR), and JPEG with gain maps (JPEG-R / Ultra HDR) in pure JavaScript. It has no native bindings and works in Node.js and browsers.

Every reader returns a shared `HdrifyImage` (float RGBA pixels) and every writer accepts it, so converting between formats is a read followed by a write.

[Read the Docs to Learn More](https://hdrify.ben3d.ca/).

## Packages

| Package                                                     | Version (click for changelogs)                                                                                                                                          |
| ----------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [hdrify](packages/hdrify)                                   | [![hdrify version](https://img.shields.io/npm/v/hdrify.svg?label=%20)](https://github.com/bhouston/hdrify/releases)                                                     |
| [hdrify-cli](packages/cli)                                  | [![hdrify-cli version](https://img.shields.io/npm/v/hdrify-cli.svg?label=%20)](https://github.com/bhouston/hdrify/releases)                                             |
| [hdrify-react](packages/hdrify-react)                       | [![hdrify-react version](https://img.shields.io/npm/v/hdrify-react.svg?label=%20)](https://github.com/bhouston/hdrify/releases)                                         |
| [hdrify-vscode-extension](packages/hdrify-vscode-extension) | [![hdrify-vscode-extension version](https://img.shields.io/open-vsx/v/benhouston3d/hdrify-vscode-extension.svg?label=%20)](https://github.com/bhouston/hdrify/releases) |

## Get started

```sh
pnpm add hdrify
```

Convert an EXR image to Radiance HDR in Node.js:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { readExr, writeHdr } from 'hdrify';

const image = readExr(readFileSync('input.exr'));
writeFileSync('output.hdr', writeHdr(image));
```

API reference: [`readExr`](https://hdrify.ben3d.ca/docs/api/core/functions/readExr/) · [`writeHdr`](https://hdrify.ben3d.ca/docs/api/core/functions/writeHdr/) · [`HdrifyImage`](https://hdrify.ben3d.ca/docs/api/core/interfaces/HdrifyImage/).

Read and write OpenEXR, Radiance HDR, JPEG XL, and JPEG gain maps with one floating-point RGBA image format. Resize, flip, convert color spaces, or apply ACES, AgX, Khronos Neutral, and Reinhard tone mapping.

## Use it where you work

- **Browser:** [Try the live viewer and converter](https://hdrify.ben3d.ca/demo/), or follow the [code examples](https://hdrify.ben3d.ca/docs/examples/).
- **React:** Add a viewer with [hdrify-react](packages/hdrify-react) and [`ImageViewer`](https://hdrify.ben3d.ca/docs/api/react/functions/ImageViewer/).
- **Terminal:** Install [hdrify-cli](packages/cli) and run `hdrify convert input.exr output.jpg`.
- **VS Code and Cursor:** [Preview and convert HDR images in your editor](packages/hdrify-vscode-extension).

See the [getting started guide](https://hdrify.ben3d.ca/docs/), [supported formats](https://hdrify.ben3d.ca/docs/formats/), and [API reference](https://hdrify.ben3d.ca/docs/api/core/) for more.

## Acknowledgements

This project would not have been possible without these projects, which were used as references:

- [Three.js](https://github.com/mrdoob/three.js) - tone mapping, UltraHDR loader, EXR loader, example images.
- [Gainmap.js](https://github.com/MONOGRID/gainmap-js) - Ultra HDR loading, saving, XMP metadata structure and JPEG-R assembly (reference implementation).
- [OpenEXR](https://github.com/AcademySoftwareFoundation/openexr) - EXR encoding/decoding for all the various compression formats, example images.

## Releases

See [RELEASING.md](RELEASING.md) for how releases are published and [GitHub Releases](https://github.com/bhouston/hdrify/releases) for changes.

## Contribution

See [Contributing Guide](CONTRIBUTING.md).

## License

MIT

## Author

[Ben Houston](https://ben3d.ca), Sponsored by [Land of Assets](https://landofassets.com).
