# Hdrify - EXR and HDR Image Libraries

A monorepo containing universal (browser + Node.js) libraries for reading and writing EXR (OpenEXR), HDR (Radiance RGBE), and gain map (JPEG-R / Ultra HDR) image formats.

## Packages

### [`hdrify`](./packages/hdrify)

Universal EXR, HDR, and gain map image library. Works in both Node.js and browsers with no Node-specific dependencies.

**Features:**
- Read and write EXR files (PIZ, ZIP, uncompressed)
- Read and write HDR (Radiance RGBE) files
- Convert HDR to LDR with tone mapping
- Encode gain maps (JPEG-R / Ultra HDR)
- Universal Uint8Array-based API (no Node.js Buffer dependency)
- Full TypeScript support

### [`hdrify-cli`](./packages/cli)

Command-line tool for converting between EXR and HDR formats and viewing file metadata.

## Installation

```bash
# Install the main library
pnpm add hdrify

# Install the CLI
pnpm add -g hdrify-cli
```

## Quick Start

### Reading an EXR file

```typescript
import { parseEXRFile } from 'hdrify';
import * as fs from 'node:fs';

// In Node.js
const buffer = fs.readFileSync('image.exr');
const imageData = parseEXRFile(new Uint8Array(buffer));

console.log(`Image: ${imageData.width}x${imageData.height}`);
// imageData.data is a Float32Array with RGBA values
```

### Reading an HDR file

```typescript
import { parseHDRFile } from 'hdrify';
import * as fs from 'node:fs';

// In Node.js
const buffer = fs.readFileSync('image.hdr');
const imageData = parseHDRFile(new Uint8Array(buffer));

console.log(`Image: ${imageData.width}x${imageData.height}`);
// imageData.data is a Float32Array with RGBA values
```

### Converting between formats

```typescript
import { parseEXRFile, writeEXRFile, parseHDRFile, writeHDRFile } from 'hdrify';
import * as fs from 'node:fs';

// Convert EXR to HDR
const exrBuffer = fs.readFileSync('input.exr');
const imageData = parseEXRFile(new Uint8Array(exrBuffer));
const hdrBuffer = writeHDRFile(imageData);
fs.writeFileSync('output.hdr', hdrBuffer);

// Convert HDR to EXR
const hdrBuffer2 = fs.readFileSync('input.hdr');
const imageData2 = parseHDRFile(new Uint8Array(hdrBuffer2));
const exrBuffer2 = writeEXRFile(imageData2);
fs.writeFileSync('output.exr', exrBuffer2);
```

### Browser usage

```typescript
import { parseEXRFile } from 'hdrify';

// In browser
const fileInput = document.querySelector('input[type="file"]');
fileInput.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const imageData = parseEXRFile(buffer);
  // Use imageData.data to render to canvas, etc.
});
```

## CLI

```bash
# Convert between formats
hdrify convert input.exr output.hdr
hdrify convert input.hdr output.exr

# View file metadata
hdrify info input.exr
hdrify info input.hdr
```

## Demos

### Web Demo

A TanStack Start web application with drag-and-drop support for viewing EXR and HDR files with an exposure slider.

```bash
cd demos/web
pnpm install
pnpm dev
```

Open http://localhost:3000 in your browser and drag-and-drop EXR or HDR files to view them.

## Development

This is a pnpm workspace monorepo.

```bash
# Install dependencies
pnpm install

# Build packages (hdrify, hdrify-cli)
pnpm build

# Run tests
pnpm test

# Type-check
pnpm tsgo

# Lint code
pnpm lint

# Clean build artifacts
pnpm clean
```

## License

MIT

## Author

Ben Houston <neuralsoft@gmail.com> (https://benhouston3d.com)
