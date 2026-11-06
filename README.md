<p align="center">
  <a href="https://hdrify.ben3d.ca" target="_blank" rel="noopener noreferrer">
    <img alt="HDRify logo" src="https://raw.githubusercontent.com/bhouston/hdrify/main/packages/website/public/logo512.png" height="96">
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

## Capabilities

- Read and write RGB, RGBA and Luminance EXR files (none, RLE, ZIPS, ZIP, PIZ, PXR24, B44, B44A, DWAA and DWAB compression)
- Read and write HDR (Radiance RGBE) files
- Read and write both Adobe Gain Map JPEGs and Ultra HDR JPEGS (Android compatible.)
- Tone mappers (ACES, Khronos Neutral, AgX and Reinhart)
- Full TypeScript support
- No DOM or Node.js dependencies (works in browser, web workers, and node.js)
- Written in a functional style to support tree-shaking
- Web app example of HDR, EXR and Ultra HDR conversion and viewing: https://hdrify.ben3d.ca/demo/
- [hdrify CLI](https://www.npmjs.com/package/hdrify-cli)
- [HDRify VS Code Extension](https://marketplace.visualstudio.com/items?itemName=benhouston3d.hdrify-vscode-extension) — for [VS Code](https://marketplace.visualstudio.com/items?itemName=benhouston3d.hdrify-vscode-extension) and [Cursor](https://open-vsx.org/extension/benhouston3d/hdrify-vscode-extension)

## Installation

```sh
pnpm add hdrify
```

## Main Entry Points

All read functions return `HdrifyImage`, and all write functions accept it (or derived types). This is the universal intermediate format used across the library.

### HdrifyImage

```ts
interface HdrifyImage {
  width: number; // Image width in pixels
  height: number; // Image height in pixels
  data: Float32Array; // RGBA pixel data: [R, G, B, A, R, G, B, A, ...]
  metadata?: Record<string, unknown>; // Format-specific header metadata (e.g. compression, exposure)
}
```

## Usage

### Reading an EXR file

```ts
import { readExr } from 'hdrify';

const buffer = fs.readFileSync('image.exr');
const imageData = readExr(new Uint8Array(buffer));

console.log(`Image: ${imageData.width}x${imageData.height}`);
// imageData.data is a Float32Array with RGBA values
```

### Reading an HDR file

```ts
import { readHdr } from 'hdrify';

const buffer = fs.readFileSync('image.hdr');
const imageData = readHdr(new Uint8Array(buffer));

console.log(`Image: ${imageData.width}x${imageData.height}`);
```

### Reading a JPEG gain map file (JPEG-R / Ultra HDR)

```ts
import { readJpegGainMap } from 'hdrify';

const buffer = fs.readFileSync('image.jpg');
const imageData = readJpegGainMap(new Uint8Array(buffer));

console.log(`Image: ${imageData.width}x${imageData.height}`);
// imageData.data is linear HDR Float32Array RGBA; metadata.format is 'ultrahdr' or 'adobe-gainmap'
```

### Converting between formats

```ts
import { encodeGainMap, readExr, writeExr, readHdr, writeHdr, writeJpegGainMap } from 'hdrify';

// Convert EXR to HDR
const exrBuffer = fs.readFileSync('input.exr');
const imageData = readExr(new Uint8Array(exrBuffer));
fs.writeFileSync('output.hdr', writeHdr(imageData));

// Convert HDR to EXR
const hdrBuffer2 = fs.readFileSync('input.hdr');
const imageData2 = readHdr(new Uint8Array(hdrBuffer2));
fs.writeFileSync('output.exr', writeExr(imageData2));

// Convert EXR or HDR to JPEG-R (JPEG with gain map—highly compressible HDR)
const imageData3 = readExr(new Uint8Array(fs.readFileSync('input.exr')));
const encoding = encodeGainMap(imageData3, { toneMapping: 'reinhard' });
fs.writeFileSync('output.jpg', writeJpegGainMap(encoding, { quality: 90 }));
```

### Browser usage

```ts
import { readExr } from 'hdrify';

const fileInput = document.querySelector('input[type="file"]');
fileInput.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const imageData = readExr(buffer);
  // Use imageData.data to render to canvas, etc.
});
```

## CLI Tool

The **hdrify-cli** package is a companion command-line tool for converting and inspecting EXR, HDR, and JPEG gain map (Ultra HDR / Adobe) files. See **[packages/cli/README.md](packages/cli/README.md)** for full CLI documentation, or install from npm:

```sh
pnpm add -g hdrify-cli
```

| Command                           | Description                                                  |
| --------------------------------- | ------------------------------------------------------------ |
| `hdrify convert <input> <output>` | Convert between EXR, HDR, JPEG gain map, PNG, WebP, and JPEG |
| `hdrify info <file>`              | Display metadata (format, dimensions, compression)           |
| `hdrify reference <output>`       | Create synthetic reference test images                       |

```bash
hdrify convert input.exr output.hdr
hdrify convert input.hdr output.exr
hdrify convert input.exr output.jpg    # JPEG-R with gain map (Ultra HDR, default)
hdrify convert input.exr output.jpg --format adobe-gainmap   # Adobe gain map format
hdrify convert input.jpg output.exr    # Read JPEG gain map as input
hdrify convert input.exr output.exr --size 1024,512 --filter lanczos   # Resize
hdrify info input.exr
hdrify info input.jpg    # JPEG gain map (Ultra HDR / Adobe)
hdrify reference output.exr --compression zip
hdrify convert input.exr output.exr --compression pxr24
```

## Demos

See the [online demo](https://hdrify.ben3d.ca/demo/). To run the website locally (`packages/website`, drag-and-drop and exposure slider):

```bash
cd packages/website
pnpm install
pnpm dev
```

Open http://localhost:3000/hdrify/demo/ and drag-and-drop EXR or HDR files.

## Development

Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting a change. Release setup and npm trusted publishing are documented in [RELEASING.md](RELEASING.md).

```bash
pnpm install
pnpm dev
pnpm tsc
pnpm build
pnpm lint # oxlint
pnpm lint:fix
pnpm format # oxfmt
pnpm test # vitest
```

CI runs tests with coverage (`pnpm test --coverage`) and enforces coverage floors and a bundle-size budget in addition to the checks in [CONTRIBUTING.md](CONTRIBUTING.md):

- Core library coverage floors: 89% statements, 72% branches, 93% functions, 89% lines.
- Bundle-size budgets are defined in `package.json` (checked with `pnpm size`, backed by `size-limit`).

Change either only with an explanation in the PR.

## Acknowledgements

This project would not have been possible without these two projects which were used a reference:

- [Three.js](https://github.com/mrdoob/three.js) - tone mapping, UltraHDR loader, EXR loader, example images.
- [Gainmap.js](https://github.com/MONOGRID/gainmap-js) - Ultra HDR loading, saving, XMP metadata structure and JPEG-R assembly (reference implementation).
- [OpenEXR](https://github.com/AcademySoftwareFoundation/openexr) - EXR encoding/decoding for all the various compression formats, example images.

## Contribution

See [Contributing Guide](CONTRIBUTING.md).

## License

MIT

## Author

[Ben Houston](https://ben3d.ca), Sponsored by [Land of Assets](https://landofassets.com).
