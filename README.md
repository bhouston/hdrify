# EXR and HDR Image Libraries

A monorepo containing universal (browser + Node.js) libraries for reading and writing EXR (OpenEXR) and HDR (Radiance RGBE) image formats.

## Packages

### [`exr-image`](./packages/exr-image)

Universal EXR (OpenEXR) file reader and writer. Works in both Node.js and browsers.

**Features:**
- Read EXR files with support for PIZ, ZIP, and uncompressed formats
- Write EXR files (uncompressed)
- Universal Buffer-based API (no Node.js dependencies)
- Full TypeScript support

### [`hdr-image`](./packages/hdr-image)

Universal HDR (Radiance RGBE) file reader and writer. Works in both Node.js and browsers.

**Features:**
- Read HDR files
- Write HDR files
- Convert HDR to LDR (Low Dynamic Range) with tone mapping
- Universal Buffer-based API (no Node.js dependencies)
- Full TypeScript support

## Installation

```bash
# Install both packages
pnpm add exr-image hdr-image

# Or install individually
pnpm add exr-image
pnpm add hdr-image
```

## Quick Start

### Reading an EXR file

```typescript
import { parseEXRFile } from 'exr-image';
import * as fs from 'node:fs';

// In Node.js
const buffer = fs.readFileSync('image.exr');
const imageData = parseEXRFile(buffer);

console.log(`Image: ${imageData.width}x${imageData.height}`);
// imageData.data is a Float32Array with RGBA values
```

### Reading an HDR file

```typescript
import { parseHDRFile } from 'hdr-image';
import * as fs from 'node:fs';

// In Node.js
const buffer = fs.readFileSync('image.hdr');
const imageData = parseHDRFile(buffer);

console.log(`Image: ${imageData.width}x${imageData.height}`);
// imageData.data is a Float32Array with RGBA values
```

### Converting between formats

```typescript
import { parseEXRFile, writeEXRFile } from 'exr-image';
import { parseHDRFile, writeHDRFile } from 'hdr-image';
import * as fs from 'node:fs';

// Convert EXR to HDR
const exrBuffer = fs.readFileSync('input.exr');
const imageData = parseEXRFile(exrBuffer);
const hdrBuffer = writeHDRFile(imageData);
fs.writeFileSync('output.hdr', hdrBuffer);

// Convert HDR to EXR
const hdrBuffer2 = fs.readFileSync('input.hdr');
const imageData2 = parseHDRFile(hdrBuffer2);
const exrBuffer2 = writeEXRFile(imageData2);
fs.writeFileSync('output.exr', exrBuffer2);
```

### Browser usage

```typescript
import { parseEXRFile } from 'exr-image';

// In browser
const fileInput = document.querySelector('input[type="file"]');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer); // Or use a Buffer polyfill
  
  const imageData = parseEXRFile(buffer);
  // Use imageData.data to render to canvas, etc.
});
```

## Demos

### CLI Demo

A command-line tool for converting between EXR and HDR formats and viewing file metadata.

```bash
cd demos/cli
pnpm install
pnpm build
pnpm start convert input.exr output.hdr
pnpm start info input.exr
```

**Commands:**
- `convert <input> <output>` - Convert between EXR and HDR formats
- `info <file>` - Display file metadata (width, height, compression, etc.)

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

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint

# Clean build artifacts
pnpm clean
```

## License

MIT

## Author

Ben Houston <neuralsoft@gmail.com> (https://benhouston3d.com)
