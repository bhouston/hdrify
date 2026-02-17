# hdrify-cli

<img src="https://hdrify.benhouston3d.com/logo192.png" alt="HDRify logo" width="192" height="192">

[![NPM Package][npm]][npm-url]
[![NPM Downloads][npm-downloads]][npmtrends-url]
[![Tests][tests-badge]][tests-url]
[![Coverage][coverage-badge]][coverage-url]

CLI for converting and inspecting EXR, HDR, and JPEG gain map (Ultra HDR / Adobe) files. Convert to highly compressible JPEG-R (JPEG with gain maps) for efficient HDR storage. Powered by [hdrify](https://www.npmjs.com/package/hdrify).

**Related packages:** [hdrify](https://www.npmjs.com/package/hdrify) (core library) · [hdrify-react](https://www.npmjs.com/package/hdrify-react) (React component)

An **online demo** is available at **[https://hdrify.benhouston3d.com](https://hdrify.benhouston3d.com)** — HDR, EXR, and Ultra HDR viewer and converter; try it in your browser without installing the CLI.

## Installation

```sh
pnpm add -g hdrify-cli
```

## Usage

| Command | Description |
| ------- | ----------- |
| `hdrify convert <input> <output>` | Convert between EXR, HDR, JPEG gain map, PNG, WebP, and JPEG |
| `hdrify info <file>` | Display metadata (format, dimensions, compression) |
| `hdrify reference <output>` | Create synthetic reference test images |

```bash
# Convert between formats
hdrify convert input.exr output.hdr
hdrify convert input.hdr output.exr --compression piz
hdrify convert input.exr output.jpg    # JPEG-R with gain map (Ultra HDR, default)
hdrify convert input.exr output.jpg --format adobe-gainmap
hdrify convert input.jpg output.exr    # Read JPEG gain map as input
hdrify convert input.exr output.webp   # Tonemaps to SDR

# View file metadata
hdrify info input.exr
hdrify info input.hdr
hdrify info input.jpg

# Create synthetic reference images
hdrify reference output.exr --compression zip
hdrify reference output.hdr
hdrify reference output.exr --type cie-wedge
hdrify reference output.hdr --type gradient
```

## Options

**convert:** `--compression` (EXR: none, rle, zip, zips, piz, pxr24), `--format` (JPEG: ultrahdr, adobe-gainmap), `--tonemapping`, `--exposure`, `--quality`

**reference:** `--type` (rainbow, cie-wedge, cie-wedge-r, cie-wedge-g, cie-wedge-b, gradient), `--compression`, `--width`, `--height`

Run `hdrify --help` for full usage.

## License

MIT

## Author

[Ben Houston](https://benhouston3d.com), Sponsored by [Land of Assets](https://landofassets.com)

[npm]: https://img.shields.io/npm/v/hdrify-cli
[npm-url]: https://www.npmjs.com/package/hdrify-cli
[npm-downloads]: https://img.shields.io/npm/dw/hdrify-cli
[npmtrends-url]: https://www.npmtrends.com/hdrify-cli
[tests-badge]: https://github.com/bhouston/hdrify/workflows/Tests/badge.svg
[tests-url]: https://github.com/bhouston/hdrify/actions/workflows/test.yml
[coverage-badge]: https://codecov.io/gh/bhouston/hdrify/branch/main/graph/badge.svg
[coverage-url]: https://codecov.io/gh/bhouston/hdrify
