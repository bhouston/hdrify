# hdrify

<img src="https://hdrify.benhouston3d.com/logo192.png" alt="HDRify logo" width="192" height="192">

[![NPM Package][npm]][npm-url]
[![NPM Downloads][npm-downloads]][npmtrends-url]
[![Tests][tests-badge]][tests-url]
[![Coverage][coverage-badge]][coverage-url]

Universal EXR, HDR, and gain map image library for Node.js and browsers. Read and write HDR (Radiance RGBE), EXR (OpenEXR), and JPEG with gain maps (JPEG-R / Ultra HDR) in pure JavaScript. No native bindings.

**Related packages:** [hdrify-cli](https://www.npmjs.com/package/hdrify-cli) (CLI tool) · [hdrify-react](https://www.npmjs.com/package/hdrify-react) (React component)

## Features

- Read and write RGB EXR files (PIZ, PXR24, ZIP, ZIPS, and RLE compression)
- Read and write HDR (Radiance RGBE) files
- Read and write both Adobe Gain Map JPEGs and Ultra HDR JPEGs (Android compatible)
- Tone mappers (ACES, Khronos Neutral, AgX, Reinhard)
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
  data: Float32Array;     // RGBA: [R, G, B, A, R, G, B, A, ...]
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

## License

MIT

## Author

[Ben Houston](https://benhouston3d.com), Sponsored by [Land of Assets](https://landofassets.com)

[npm]: https://img.shields.io/npm/v/hdrify
[npm-url]: https://www.npmjs.com/package/hdrify
[npm-downloads]: https://img.shields.io/npm/dw/hdrify
[npmtrends-url]: https://www.npmtrends.com/hdrify
[tests-badge]: https://github.com/bhouston/hdrify/workflows/Tests/badge.svg
[tests-url]: https://github.com/bhouston/hdrify/actions/workflows/test.yml
[coverage-badge]: https://codecov.io/gh/bhouston/hdrify/branch/main/graph/badge.svg
[coverage-url]: https://codecov.io/gh/bhouston/hdrify
