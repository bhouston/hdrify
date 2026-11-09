<p align="center">
  <a href="https://hdrify.ben3d.ca" target="_blank" rel="noopener noreferrer">
    <img alt="hdrify logo" src="https://raw.githubusercontent.com/bhouston/hdrify/main/packages/hdrify-vscode-extension/images/icon.png" height="96">
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

# hdrify

> Read and write EXR, HDR, and Ultra HDR images in pure JavaScript.

- 📦 Pure JavaScript, No Native Bindings
- 🌐 Node.js, Browsers, and Web Workers
- 🗜️ All Major EXR Compressions
- 📸 Adobe and Ultra HDR Gain Maps
- 🎨 Four Built-in Tone Mappers
- 🔷 Full TypeScript Support

Universal EXR, HDR, and gain map image library for Node.js and browsers. Read and write HDR (Radiance RGBE), EXR (OpenEXR), and JPEG with gain maps (JPEG-R / Ultra HDR) in pure JavaScript. No native bindings.

**Related packages:** [hdrify-cli](https://www.npmjs.com/package/hdrify-cli) (CLI tool) · [hdrify-react](https://www.npmjs.com/package/hdrify-react) (React component)

## Capabilities

- Read and write RGB EXR files (none, RLE, ZIPS, ZIP, PIZ, PXR24, B44, B44A, DWAA and DWAB compression)
- Read and write HDR (Radiance RGBE) and JPEG XL files
- Read and write both Adobe Gain Map JPEGs and Ultra HDR JPEGs (Android compatible)
- Tone mappers (ACES, Khronos Neutral, AgX, Reinhard)
- Resize with nearest, bilinear, or lanczos filters
- Flip horizontally and/or vertically
- Full TypeScript support
- No DOM or Node.js dependencies (works in browser, web workers, and Node.js)
- Written in a functional style to support tree-shaking

## Installation

```sh
pnpm add hdrify
```

Readers return a shared [`HdrifyImage`](https://hdrify.ben3d.ca/docs/api/core/interfaces/HdrifyImage/) with floating-point RGBA pixels, ready to transform or write in another format.

## Usage

### Reading an EXR file

```ts
import * as fs from 'node:fs';
import { readExr } from 'hdrify';

const buffer = fs.readFileSync('image.exr');
const image = readExr(new Uint8Array(buffer));

console.log(`Image: ${image.width}x${image.height}`);
```

API reference: [`readExr`](https://hdrify.ben3d.ca/docs/api/core/functions/readExr/).

### Reading an HDR file

```ts
import * as fs from 'node:fs';
import { readHdr } from 'hdrify';

const buffer = fs.readFileSync('image.hdr');
const image = readHdr(new Uint8Array(buffer));
```

API reference: [`readHdr`](https://hdrify.ben3d.ca/docs/api/core/functions/readHdr/).

### Reading a JPEG gain map (JPEG-R / Ultra HDR)

```ts
import * as fs from 'node:fs';
import { readJpegGainMap } from 'hdrify';

const buffer = fs.readFileSync('image.jpg');
const image = readJpegGainMap(new Uint8Array(buffer));
// image.data is linear HDR Float32Array RGBA; metadata.format is 'ultrahdr' or 'adobe-gainmap'
```

API reference: [`readJpegGainMap`](https://hdrify.ben3d.ca/docs/api/core/functions/readJpegGainMap/).

### Converting between formats

```ts
import * as fs from 'node:fs';
import { encodeGainMap, readExr, writeHdr, writeJpegGainMap } from 'hdrify';

const image = readExr(new Uint8Array(fs.readFileSync('input.exr')));
fs.writeFileSync('output.hdr', writeHdr(image));

const encoding = encodeGainMap(image, { toneMapping: 'reinhard' });
fs.writeFileSync('output.jpg', writeJpegGainMap(encoding, { quality: 90 }));
```

API reference: [`encodeGainMap`](https://hdrify.ben3d.ca/docs/api/core/functions/encodeGainMap/) · [`writeHdr`](https://hdrify.ben3d.ca/docs/api/core/functions/writeHdr/) · [`writeJpegGainMap`](https://hdrify.ben3d.ca/docs/api/core/functions/writeJpegGainMap/).

### Reading and writing JPEG XL

```ts
import * as fs from 'node:fs';
import { readJxl, writeJxl } from 'hdrify';

const image = readJxl(fs.readFileSync('input.jxl'));
fs.writeFileSync('output.jxl', writeJxl(image));
```

API reference: [`readJxl`](https://hdrify.ben3d.ca/docs/api/core/functions/readJxl/) · [`readJxlFrames`](https://hdrify.ben3d.ca/docs/api/core/functions/readJxlFrames/) · [`writeJxl`](https://hdrify.ben3d.ca/docs/api/core/functions/writeJxl/).

### Resizing

```ts
import * as fs from 'node:fs';
import { readExr, resizeImage, writeExr } from 'hdrify';

const image = readExr(new Uint8Array(fs.readFileSync('input.exr')));
const resized = resizeImage(image, { width: 1024, height: 512, filter: 'lanczos' });
fs.writeFileSync('output.exr', writeExr(resized));
```

API reference: [`resizeImage`](https://hdrify.ben3d.ca/docs/api/core/functions/resizeImage/).

### Flipping

```ts
import * as fs from 'node:fs';
import { flipImage, readExr } from 'hdrify';

const image = readExr(new Uint8Array(fs.readFileSync('input.exr')));
const flipped = flipImage(image, { y: -1 });
```

API reference: [`flipImage`](https://hdrify.ben3d.ca/docs/api/core/functions/flipImage/).

## Documentation

Full documentation for the library is available [on the HDRify documentation website](https://hdrify.ben3d.ca/docs/).

[Code examples](https://hdrify.ben3d.ca/docs/examples/) · [Formats and color](https://hdrify.ben3d.ca/docs/formats/) · [Full API reference](https://hdrify.ben3d.ca/docs/api/core/)

## Contribution

See [Contributing Guide](https://github.com/bhouston/hdrify/blob/main/CONTRIBUTING.md).

## License

MIT

## Author

[Ben Houston](https://ben3d.ca), Sponsored by [Land of Assets](https://landofassets.com).
