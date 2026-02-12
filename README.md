# HDFify

<img src="https://hdrify.benhouston3d.com/logo192.png" alt="HDRify logo" width="64" height="64">

[![NPM Package][npm]][npm-url]
[![NPM Downloads][npm-downloads]][npmtrends-url]
[![Tests][tests-badge]][tests-url]
[![Coverage][coverage-badge]][coverage-url]

HDRify implements comprehensive support for high dynamic range imaging with support for HDR (Radiance RGBE), EXR (OpenEXR), and JPEG with gain maps (JPEG-R / Ultra HDR) reading and writing in pure JavaScript. No native bindings—works in Node.js and browsers.

**→ [Online demo](https://hdrify.benhouston3d.com)** — HDR, EXR, and Ultra HDR (JPEG-R) viewer and converter (the `demos/web-converter` from this repo). Try it in your browser.

## Features

- Read and write RGB EXR files (PIZ, PXR24, ZIP, ZIPS, and RLE compression)
- Read and write HDR (Radiance RGBE) files
- Write JPEGs with gain maps (JPEG-R / Ultra HDR) — a new, highly compressible HDR format. Convert EXR or HDR to JPEG-R for efficient storage and broad compatibility (modern browsers, mobile).
- Tone mapping utilities for easing conversion of HDR to LDR images
- Full TypeScript support
- No DOM or Node.js dependencies (works in browser, web workers, and node.js)
- Written in a functional style to support tree-shaking
- Web app example of HDR, EXR and Ultra HDR conversion and vieweing: https://hdrify.benhouston3d.com
- [hdrify CLI](https://www.npmjs.com/package/hdrify-cli)

## Installation

```sh
pnpm add hdrify
```

## Main Entry Points

| Function | Description |
| -------- | ----------- |
| `readHdr(hdrBuffer: Uint8Array)` | Parse Radiance RGBE HDR file → `FloatImageData` |
| `writeHdr(imageData: FloatImageData)` | Encode `FloatImageData` → HDR bytes |
| `readExr(exrBuffer: Uint8Array)` | Parse OpenEXR file (PIZ, ZIP, RLE) → `FloatImageData` |
| `writeExr(imageData, options?)` | Encode `FloatImageData` → EXR bytes |
| `writeJpegGainMap(encodingResult, options?)` | Encode HDR as JPEG-R (JPEG with gain map) for highly compressible storage |

All read functions return `FloatImageData`, and all write functions accept it (or derived types). This is the universal intermediate format used across the library.

### FloatImageData

```ts
interface FloatImageData {
  width: number;           // Image width in pixels
  height: number;          // Image height in pixels
  data: Float32Array;     // RGBA pixel data: [R, G, B, A, R, G, B, A, ...]
  metadata?: Record<string, unknown>;  // Format-specific header metadata (e.g. compression, exposure)
}
```

## Usage

### Reading an EXR file

```ts
import { readExr } from 'hdrify';
import * as fs from 'node:fs';

const buffer = fs.readFileSync('image.exr');
const imageData = readExr(new Uint8Array(buffer));

console.log(`Image: ${imageData.width}x${imageData.height}`);
// imageData.data is a Float32Array with RGBA values
```

### Reading an HDR file

```ts
import { readHdr } from 'hdrify';
import * as fs from 'node:fs';

const buffer = fs.readFileSync('image.hdr');
const imageData = readHdr(new Uint8Array(buffer));

console.log(`Image: ${imageData.width}x${imageData.height}`);
```

### Converting between formats

```ts
import { encodeGainMap, readExr, writeExr, readHdr, writeHdr, writeJpegGainMap } from 'hdrify';
import * as fs from 'node:fs';

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

The **hdrify-cli** package is a companion command-line tool for converting and inspecting EXR/HDR files:

```sh
pnpm add -g hdrify-cli
```

| Command | Description |
| ------- | ----------- |
| `hdrify convert <input> <output>` | Convert between EXR, HDR, PNG, WebP, and JPEG (JPEG-R gain map when output is .jpg) |
| `hdrify info <file>` | Display metadata (format, dimensions, compression) |
| `hdrify reference <output>` | Create synthetic reference test images |

```bash
hdrify convert input.exr output.hdr
hdrify convert input.hdr output.exr
hdrify convert input.exr output.jpg    # JPEG-R with gain map (highly compressible HDR)
hdrify info input.exr
hdrify reference output.exr --compression zip
hdrify convert input.exr output.exr --compression pxr24
```

## Demos

See the **online demo** link at the top. To run the web-converter locally (`demos/web-converter`, drag-and-drop and exposure slider):

```bash
cd demos/web-converter
pnpm install
pnpm dev
```

Open http://localhost:3000 and drag-and-drop EXR or HDR files.

## Developer (for Contributors)

Check out [this git project](https://github.com/bhouston/hdrify) and run:

```sh
# install dependencies
pnpm install

# build packages (hdrify, hdrify-cli)
pnpm build

# run tests
pnpm test

# type-check
pnpm tsgo

# lint
pnpm check

# clean build artifacts
pnpm clean

# publish the npm packages
pnpm make-release:hdrify
pnpm make-release:hdrify-cli
```

## License

MIT

## Author

Ben Houston <neuralsoft@gmail.com> (https://benhouston3d.com), Sponsored by [Land of Assets](https://landofassets.com)

[npm]: https://img.shields.io/npm/v/hdrify
[npm-url]: https://www.npmjs.com/package/hdrify
[npm-downloads]: https://img.shields.io/npm/dw/hdrify
[npmtrends-url]: https://www.npmtrends.com/hdrify
[tests-badge]: https://github.com/bhouston/hdrify/workflows/Tests/badge.svg
[tests-url]: https://github.com/bhouston/hdrify/actions/workflows/test.yml
[coverage-badge]: https://codecov.io/gh/bhouston/hdrify/branch/main/graph/badge.svg
[coverage-url]: https://codecov.io/gh/bhouston/hdrify
