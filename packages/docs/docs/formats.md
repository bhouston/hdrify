---
title: Formats and color
sidebar_position: 2
---

# Formats and color

## Choose an output for its purpose

| Format | Core reader / writer | Use it for |
| --- | --- | --- |
| OpenEXR (`.exr`) | `readExr` / `writeExr` | Floating point image workflows, environment maps, and configurable compression |
| Radiance HDR (`.hdr`) | `readHdr` / `writeHdr` | RGBE HDR images and environment map interchange |
| JPEG gain map (`.jpg`, `.jpeg`) | `readJpegGainMap` / `writeJpegGainMap` | An SDR JPEG plus gain data for reconstructing HDR |

The CLI also writes tone-mapped PNG and WebP. JPEG output from the CLI is a JPEG gain map by default; an ordinary JPEG without the required gain map metadata is not a supported HDR input.

OpenEXR compression options are `none`, `rle`, `zip`, `zips`, `piz`, `pxr24`, `b44`, `b44a`, `dwaa`, and `dwab`. Codec choice affects size, speed, precision, and compatibility. Compressed EXR output uses HALF channels; uncompressed output uses FLOAT channels. Do not assume that changing formats or selecting a lossless compression algorithm preserves every original floating point sample.

JPEG gain maps support `ultrahdr` (the default) and `adobe-gainmap` layouts. JPEG compression is lossy. Native HDR presentation depends on the image viewer, browser, operating system, and display; an SDR base image remains useful when the gain map is not used.

## The shared image representation

```ts
import type { HdrifyImage } from 'hdrify';

const image: HdrifyImage = {
  width: 1,
  height: 1,
  data: new Float32Array([4, 2, 0.5, 1]),
  linearColorSpace: 'linear-rec709',
};
```

`data` contains `width * height * 4` values in interleaved RGBA order. RGB values are linear light and can exceed `1`; the example pixel is brighter than a normalized display white. Alpha occupies every fourth value. `metadata` optionally contains source header information.

The supported linear primaries are `linear-rec709`, `linear-p3`, and `linear-rec2020`. Color space describes how RGB components map to colors; it is separate from the brightness range and file compression. Do not relabel an image to change its primaries: use `convertLinearColorSpace(image, target)`.

## Linear pixels and display pixels

A browser's usual 8-bit canvas image data is display encoded, not linear HDR data. `applyToneMapping` accepts floating point **RGBA** and returns 8-bit, sRGB-encoded **RGB**, with three bytes per pixel. It converts source primaries when `sourceColorSpace` is supplied, applies exposure and a tone mapper, then encodes sRGB.

Exposure is a linear multiplier: `1` leaves exposure unchanged, `2` adds one stop, and `0.5` subtracts one stop. Tone mapping compresses the range for SDR viewing; keep the original image for HDR export.

`convertLinearToDisplay` and `convertDisplayToLinear` handle transfer functions and primaries. A transfer-function conversion alone is not an HDR-to-SDR tone mapper. Display-encoded results must not be passed back into functions expecting linear pixels without decoding them first.

## Data handling details

`readExr` and `writeExr` sanitize negative and non-finite samples by default. For normal, depth, or disparity data, pass `{ sanitize: false }` explicitly to both. Tone mapping and gain map encoding also sanitize their input buffers in place. Copy `image.data` first if you need the untouched samples.

`readHdr` returns stored pixel values by default. Pass `{ output: 'physicalRadiance' }` to divide by the file's accumulated `EXPOSURE` header value. This interpretation is separate from exposure used for a display preview.

See the [core API reference](/docs/api/core) for the precise options and return types.
