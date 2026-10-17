---
title: Code examples
sidebar_position: 3
---

# Code examples

Install `hdrify` first. Node examples use ES modules and can be saved as `.mjs` files. Browser examples assume a bundler that resolves npm imports.

## OpenEXR to Radiance HDR

```js
import { readFile, writeFile } from 'node:fs/promises';
import { readExr, writeHdr } from 'hdrify';

const image = readExr(await readFile('environment.exr'));
await writeFile('environment.hdr', writeHdr(image));
```

Radiance HDR stores RGBE rather than the original EXR channel representation. Keep the EXR source when its precision or metadata matters.

## Create and read a JPEG gain map

Encoding and assembling the JPEG are separate steps. `encodeGainMap` produces the SDR pixels, gain map pixels, and metadata; `writeJpegGainMap` packages them into a single file.

```js
import { readFile, writeFile } from 'node:fs/promises';
import { encodeGainMap, readExr, readJpegGainMap, writeExr, writeJpegGainMap } from 'hdrify';

const image = readExr(await readFile('environment.exr'));
const encoding = encodeGainMap(image, {
  toneMapping: 'aces',
  exposure: 1,
});
const jpeg = writeJpegGainMap(encoding, {
  quality: 90,
  format: 'ultrahdr',
});
await writeFile('environment.jpg', jpeg);

const reconstructed = readJpegGainMap(jpeg);
await writeFile('reconstructed.exr', writeExr(reconstructed));
```

Use `format: 'adobe-gainmap'` for the alternative JPEG layout. Reconstruction is not a lossless round trip because the base image and gain map are JPEG compressed.

## Resize and convert primaries

```js
import { readFile, writeFile } from 'node:fs/promises';
import { convertLinearColorSpace, readExr, resizeImage, writeExr } from 'hdrify';

const source = readExr(await readFile('environment.exr'));
const rec709 = convertLinearColorSpace(source, 'linear-rec709');
const resized = resizeImage(rec709, {
  width: 1024,
  height: 512,
  filter: 'lanczos',
});
await writeFile('small.exr', writeExr(resized, { compression: 'piz' }));
```

Width and height are explicit; choose dimensions that preserve your desired aspect ratio. Resize filters include `nearest`, `bilinear`, and `lanczos`.

## Load and preview an HDR file in a browser

Add `<canvas id="preview"></canvas>` to your page and call this function from a module. It checks the HTTP response, decodes the image, and expands tone-mapped RGB bytes into canvas RGBA bytes.

```ts
import { applyToneMapping, readHdr } from 'hdrify';

async function drawPreview(url: string, canvas: HTMLCanvasElement): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load HDR image: ${response.status}`);
  }
  const image = readHdr(new Uint8Array(await response.arrayBuffer()));
  const rgb = applyToneMapping(image.data, image.width, image.height, {
    sourceColorSpace: image.linearColorSpace,
    toneMapping: 'agx',
    exposure: 1,
  });

  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!context) throw new Error('A 2D canvas context is required');
  const pixels = context.createImageData(image.width, image.height);
  for (let pixel = 0; pixel < image.width * image.height; pixel++) {
    pixels.data[pixel * 4] = rgb[pixel * 3]!;
    pixels.data[pixel * 4 + 1] = rgb[pixel * 3 + 1]!;
    pixels.data[pixel * 4 + 2] = rgb[pixel * 3 + 2]!;
    pixels.data[pixel * 4 + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
}

const canvas = document.querySelector<HTMLCanvasElement>('#preview');
if (!canvas) throw new Error('Missing preview canvas');
await drawPreview('/images/environment.hdr', canvas);
```

For a file picker, replace the `fetch` call with `new Uint8Array(await file.arrayBuffer())`. This canvas preview is SDR: it makes HDR content viewable through tone mapping. For a ready-made component, see the [React guide](/docs/react), or try the [live demo](pathname:///hdrify/demo/).

## Decode ordinary display pixels into linear light

When starting from sRGB canvas bytes, normalize every channel before decoding the transfer function. This does not recover HDR detail missing from an SDR image.

```ts
import { convertDisplayToLinear } from 'hdrify';

function fromSrgbCanvas(pixels: ImageData) {
  const normalized = Float32Array.from(pixels.data, (value) => value / 255);
  return convertDisplayToLinear(normalized, pixels.width, pixels.height, 'display-srgb', 'linear-rec709');
}
```

Use the matching display space if the source canvas is Display P3. See [formats and color](/docs/formats) for the distinction between primaries, transfer functions, and tone mapping.
