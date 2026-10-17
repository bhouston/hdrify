---
title: Command line
sidebar_position: 5
---

# Command line

Use `hdrify-cli` to convert, inspect, and generate image assets from a terminal. It uses the core HDRify library and adds SDR output through image encoding tools.

```sh
npm install --global hdrify-cli
hdrify --help
```

## Convert HDR assets

The input and output extensions select the file formats:

```sh
hdrify convert environment.exr environment.hdr
hdrify convert environment.hdr environment.exr --compression piz
hdrify convert environment.exr environment.jpg --quality 90
hdrify convert environment.exr adobe.jpg --format adobe-gainmap
hdrify convert environment.jpg reconstructed.exr
```

JPEG output defaults to Ultra HDR / JPEG-R with an embedded gain map. JPEG input must contain a supported gain map; ordinary SDR JPEG input is not supported. HDR inputs are `.exr`, `.hdr`, `.jpg`, and `.jpeg`.

## Create SDR previews

```sh
hdrify convert environment.exr preview.png --tonemapping aces --exposure 1
hdrify convert environment.hdr preview.webp --tonemapping agx --exposure 2
```

PNG and WebP output is tone-mapped SDR. Supported tone mappers are `aces`, `reinhard`, `neutral`, and `agx`. Exposure is a multiplier: `2` is one stop brighter, `0.5` is one stop darker.

## Resize and mirror

```sh
hdrify convert environment.exr small.exr --size 1024,512
hdrify convert environment.exr square.png --size 512 --filter bilinear
hdrify convert environment.exr mirrored.exr --flip=-1,1
hdrify convert environment.exr upside-down.exr --flip=1,-1
```

A single size creates a square; `WIDTH,HEIGHT` sets both dimensions explicitly. Resize filters are `nearest`, `bilinear`, and `lanczos` (the default). Flip values are `X,Y`, with each axis set to `1` or `-1`. The equals form keeps a leading negative value attached to its option in the shell.

## Inspect files and generate references

```sh
hdrify info environment.exr
hdrify info environment.hdr
hdrify info environment.jpg
hdrify reference rainbow.exr --compression zip --width 1024 --height 512
hdrify reference wedge.exr --type cie-wedge
hdrify reference gradient.hdr --type gradient
```

Reference types include `rainbow`, `cie-wedge`, `cie-wedge-r`, `cie-wedge-g`, `cie-wedge-b`, and `gradient`. Use them to exercise your image pipeline with reproducible inputs.

## Common conversion options

| Option | Meaning |
| --- | --- |
| `--compression` | EXR output codec: `none`, `rle`, `zip`, `zips`, `piz`, `pxr24`, `b44`, `b44a`, `dwaa`, `dwab` |
| `--format` | JPEG layout: `ultrahdr` or `adobe-gainmap` |
| `--tonemapping` | Tone mapper for preview/base image creation |
| `--exposure` | Linear exposure multiplier |
| `--quality` | JPEG quality from `0` to `100` |
| `--size` | `WIDTH,HEIGHT` or one size for a square |
| `--filter` | Resampling filter used with `--size` |
| `--flip` | Horizontal and vertical direction as `X,Y` |

Compression only applies to EXR output; gain map format only applies to JPEG output. Run `hdrify convert --help`, `hdrify reference --help`, or `hdrify info --help` for the installed version's command details.

Prefer a browser workflow? The [live demo](/demo/) retains the viewer and converter without a CLI installation. For code integration, use the [examples](/docs/examples).
