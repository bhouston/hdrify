# hdr-image

Universal HDR (Radiance RGBE) file reader and writer for Node.js and browsers.

## Installation

```bash
pnpm add hdr-image
# or
npm install hdr-image
# or
yarn add hdr-image
```

## Features

- ✅ Read HDR files
- ✅ Write HDR files
- ✅ Convert HDR to LDR (Low Dynamic Range) with tone mapping
- ✅ Universal API - works in Node.js and browsers
- ✅ No Node.js dependencies - uses Buffer API only
- ✅ Full TypeScript support

## Usage

### Reading an HDR file

```typescript
import { parseHDRFile } from 'hdr-image';

// In Node.js
import * as fs from 'node:fs';
const buffer = fs.readFileSync('image.hdr');
const imageData = parseHDRFile(buffer);

// In browser
const fileInput = document.querySelector('input[type="file"]');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer); // Or use a Buffer polyfill
  
  const imageData = parseHDRFile(buffer);
  console.log(`Image: ${imageData.width}x${imageData.height}`);
});
```

### Writing an HDR file

```typescript
import { writeHDRFile, type FloatImageData } from 'hdr-image';

const imageData: FloatImageData = {
  width: 512,
  height: 512,
  data: new Float32Array(512 * 512 * 4), // RGBA format
};

// Fill with your pixel data...
// imageData.data[0] = r, imageData.data[1] = g, imageData.data[2] = b, imageData.data[3] = a
// imageData.data[4] = next pixel R, etc.

const hdrBuffer = writeHDRFile(imageData);

// In Node.js
import * as fs from 'node:fs';
fs.writeFileSync('output.hdr', hdrBuffer);

// In browser
const blob = new Blob([hdrBuffer]);
const url = URL.createObjectURL(blob);
// Download or use the blob
```

### Converting HDR to LDR

```typescript
import { convertHDRToLDR, hdrToLdr } from 'hdr-image';

// Simple conversion with defaults (exposure: 1.0, gamma: 2.2)
const result = convertHDRToLDR(hdrBuffer);
// result.ldrData is a Buffer with RGB uint8 data
// result.width and result.height are the image dimensions

// Custom exposure and gamma
const result2 = convertHDRToLDR(hdrBuffer, {
  exposure: 2.0,
  gamma: 1.8,
});

// Or convert Float32Array directly
const imageData = parseHDRFile(hdrBuffer);
const ldrData = hdrToLdr(imageData.data, imageData.width, imageData.height, {
  exposure: 1.5,
  gamma: 2.2,
});
```

## API Reference

### `parseHDRFile(hdrBuffer: Buffer): FloatImageData`

Parses an HDR file buffer and returns image data.

**Parameters:**
- `hdrBuffer` - Buffer containing HDR file data

**Returns:**
- `FloatImageData` object with:
  - `width: number` - Image width in pixels
  - `height: number` - Image height in pixels
  - `data: Float32Array` - RGBA pixel data as Float32Array: [R, G, B, A, R, G, B, A, ...]
  - `exposure?: number` - Optional exposure value from file
  - `gamma?: number` - Optional gamma value from file

### `writeHDRFile(floatImageData: FloatImageData): Buffer`

Writes an HDR file buffer from FloatImageData.

**Parameters:**
- `floatImageData` - FloatImageData containing image dimensions and pixel data

**Returns:**
- Buffer containing HDR file data

### `convertHDRToLDR(hdrBuffer: Buffer, options?: HDRToLDROptions): { width: number; height: number; ldrData: Buffer }`

Converts an HDR file buffer to LDR (Low Dynamic Range) RGB buffer.

**Parameters:**
- `hdrBuffer` - Buffer containing HDR file data
- `options` - Optional tone mapping options:
  - `exposure?: number` - Exposure value (default: 1.0 or from file)
  - `gamma?: number` - Gamma value (default: 2.2 or from file)

**Returns:**
- Object with:
  - `width: number` - Image width
  - `height: number` - Image height
  - `ldrData: Buffer` - RGB uint8 data (3 bytes per pixel)

### `hdrToLdr(hdrData: Float32Array, width: number, height: number, options?: HDRToLDROptions): Buffer`

Converts HDR float data to LDR uint8 data using tone mapping.

**Parameters:**
- `hdrData` - Float32Array of RGBA pixel data
- `width` - Image width in pixels
- `height` - Image height in pixels
- `options` - Optional tone mapping options (same as above)

**Returns:**
- Buffer containing uint8 RGB data (3 bytes per pixel)

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

### `HDRToLDROptions`

```typescript
interface HDRToLDROptions {
  exposure?: number; // Exposure value for tone mapping (default: 1.0)
  gamma?: number;    // Gamma value for gamma correction (default: 2.2)
}
```

## Tone Mapping

The conversion from HDR to LDR uses the Reinhard tone mapping algorithm:

```
toneMapped = value / (1 + value)
```

This compresses high values while preserving detail in shadows. The result is then gamma-corrected and clamped to the 0-255 range.

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
