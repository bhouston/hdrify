---
slug: /
title: Get started
sidebar_position: 1
---

# HDR images, with a TypeScript workflow

HDRify reads, processes, and writes high dynamic range images in Node.js and the browser. Use the same floating point image representation for OpenEXR, Radiance HDR, and JPEG gain maps, then choose an output for your pipeline or audience.

- **Keep your working range:** read HDR pixels into linear floating point RGBA instead of reducing them to 8-bit display values.
- **Ship smaller HDR assets:** encode JPEG-R with an SDR base image and an embedded gain map.
- **Build previews:** apply ACES, AgX, neutral, or Reinhard tone mapping, with exposure control.
- **Integrate where you work:** use the core library, React canvas component, command line tools, or VS Code extension.

[Open the live viewer and converter](/demo/) to experiment with your own files before writing code. The demo remains available alongside these guides.

## Install

```sh
npm install hdrify
```

The core package provides byte-oriented APIs. You supply file bytes from `node:fs`, `fetch`, or a browser `File`; HDRify does not require a rendering engine for decoding or gain map encoding.

## Convert an HDR image in Node.js

Save this as `convert.mjs` and run `node convert.mjs` next to `input.hdr`:

```js
import { readFile, writeFile } from 'node:fs/promises';
import { readHdr, writeExr } from 'hdrify';

const image = readHdr(await readFile('input.hdr'));
console.log(image.width, image.height, image.linearColorSpace);
await writeFile('output.exr', writeExr(image, { compression: 'zip' }));
```

Readers and writers are synchronous; file loading and saving in this example are asynchronous. For large images in an interactive application, consider moving CPU work to a worker.

## Pick your next step

| Goal | Guide |
| --- | --- |
| Understand file formats, precision, and linear pixels | [Formats and color](/docs/formats) |
| Convert files, create gain maps, or draw a browser preview | [Code examples](/docs/examples) |
| Add an HDR preview to a React application | [React](/docs/react) |
| Convert assets without writing an application | [Command line](/docs/cli) |
| Look up exported functions and options | [Core API](/docs/api/core) and [React API](/docs/api/react) |

The API reference is generated from the package exports and source comments, so the signatures stay connected to the implementation.
