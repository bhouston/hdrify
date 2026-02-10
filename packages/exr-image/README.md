# exr-image

Universal EXR (OpenEXR) file reader and writer for Node.js and browsers.

## Installation

```bash
pnpm add exr-image
# or
npm install exr-image
# or
yarn add exr-image
```

## Features

- ✅ Read EXR files (supports PIZ, ZIP, and uncompressed formats)
- ✅ Write EXR files (uncompressed)
- ✅ Universal API - works in Node.js and browsers
- ✅ No Node.js dependencies - uses Buffer API only
- ✅ Full TypeScript support
- ✅ Zero dependencies (except `fflate` for ZIP decompression)

## Usage

### Reading an EXR file

```typescript
import { parseEXRFile } from 'exr-image';

// In Node.js
import * as fs from 'node:fs';
const buffer = fs.readFileSync('image.exr');
const imageData = parseEXRFile(buffer);

// In browser
const fileInput = document.querySelector('input[type="file"]');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer); // Or use a Buffer polyfill
  
  const imageData = parseEXRFile(buffer);
  console.log(`Image: ${imageData.width}x${imageData.height}`);
});
```

### Writing an EXR file

```typescript
import { writeEXRFile, type FloatImageData } from 'exr-image';

const imageData: FloatImageData = {
  width: 512,
  height: 512,
  data: new Float32Array(512 * 512 * 4), // RGBA format
};

// Fill with your pixel data...
// imageData.data[0] = r, imageData.data[1] = g, imageData.data[2] = b, imageData.data[3] = a
// imageData.data[4] = next pixel R, etc.

const exrBuffer = writeEXRFile(imageData);

// In Node.js
import * as fs from 'node:fs';
fs.writeFileSync('output.exr', exrBuffer);

// In browser
const blob = new Blob([exrBuffer]);
const url = URL.createObjectURL(blob);
// Download or use the blob
```

## API Reference

### `parseEXRFile(exrBuffer: Buffer): FloatImageData`

Parses an EXR file buffer and returns image data.

**Parameters:**
- `exrBuffer` - Buffer containing EXR file data

**Returns:**
- `FloatImageData` object with:
  - `width: number` - Image width in pixels
  - `height: number` - Image height in pixels
  - `data: Float32Array` - RGBA pixel data as Float32Array: [R, G, B, A, R, G, B, A, ...]

**Throws:**
- Error if the file is not a valid EXR file
- Error if the file uses unsupported features (multi-part, tiled)

### `writeEXRFile(floatImageData: FloatImageData): Buffer`

Writes an EXR file buffer from FloatImageData.

**Parameters:**
- `floatImageData` - FloatImageData containing image dimensions and pixel data

**Returns:**
- Buffer containing EXR file data

### `FloatImageData`

```typescript
interface FloatImageData {
  width: number;
  height: number;
  data: Float32Array; // RGBA format: [R, G, B, A, R, G, B, A, ...]
  exposure?: number;  // Optional exposure value
  gamma?: number;     // Optional gamma value
}
```

## Supported Compression Formats

- ✅ PIZ compression (read)
- ✅ ZIP compression (read)
- ✅ Uncompressed (read/write)

## Browser Support

This package works in modern browsers. For Buffer support in browsers, you may need a polyfill like `buffer`:

```bash
pnpm add buffer
```

```typescript
import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;
```

## License

MIT
