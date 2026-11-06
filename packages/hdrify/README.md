<p align="center">
  <a href="https://hdrify.ben3d.ca" target="_blank" rel="noopener noreferrer">
    <img alt="hdrify logo" src="https://raw.githubusercontent.com/bhouston/hdrify/main/packages/website/public/logo512.png" height="96">
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

[Read the Docs to Learn More](https://hdrify.ben3d.ca/).

## Capabilities

- Read and write RGB EXR files (none, RLE, ZIPS, ZIP, PIZ, PXR24, B44, B44A, DWAA and DWAB compression)
- Read and write HDR (Radiance RGBE) files
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

## HdrifyImage

All read functions return `HdrifyImage`, and all write functions accept it. This is the universal intermediate format.

```ts
interface HdrifyImage {
  width: number;
  height: number;
  data: Float32Array; // RGBA: [R, G, B, A, R, G, B, A, ...]
  linearColorSpace: LinearColorSpace;
  metadata?: Record<string, unknown>;
}
```

## Usage

### Reading an EXR file

```ts
import { readExr } from 'hdrify';

const buffer = fs.readFileSync('image.exr');
const image = readExr(new Uint8Array(buffer));

console.log(`Image: ${image.width}x${image.height}`);
```

### Reading an HDR file

```ts
import { readHdr } from 'hdrify';

const buffer = fs.readFileSync('image.hdr');
const image = readHdr(new Uint8Array(buffer));
```

### Reading a JPEG gain map (JPEG-R / Ultra HDR)

```ts
import { readJpegGainMap } from 'hdrify';

const buffer = fs.readFileSync('image.jpg');
const image = readJpegGainMap(new Uint8Array(buffer));
// image.data is linear HDR Float32Array RGBA; metadata.format is 'ultrahdr' or 'adobe-gainmap'
```

### Converting between formats

```ts
import { encodeGainMap, readExr, writeExr, readHdr, writeHdr, writeJpegGainMap } from 'hdrify';

const image = readExr(new Uint8Array(fs.readFileSync('input.exr')));
fs.writeFileSync('output.hdr', writeHdr(image));

const encoding = encodeGainMap(image, { toneMapping: 'reinhard' });
fs.writeFileSync('output.jpg', writeJpegGainMap(encoding, { quality: 90 }));
```

### Resizing

```ts
import { readExr, resizeImage, writeExr } from 'hdrify';

const image = readExr(new Uint8Array(fs.readFileSync('input.exr')));
const resized = resizeImage(image, { width: 1024, height: 512, filter: 'lanczos' }); // filter: 'nearest' | 'bilinear' | 'lanczos' (default)
fs.writeFileSync('output.exr', writeExr(resized));
```

### Flipping

```ts
import { flipImage, readExr } from 'hdrify';

const image = readExr(new Uint8Array(fs.readFileSync('input.exr')));
const flipped = flipImage(image, { y: -1 }); // x/y: 1 (default, unchanged) or -1 (mirror that axis)
```

## Contribution

See [Contributing Guide](https://github.com/bhouston/hdrify/blob/main/CONTRIBUTING.md).

## License

MIT

## Author

[Ben Houston](https://ben3d.ca), Sponsored by [Land of Assets](https://landofassets.com).
