# HDFify-cli

<img src="https://hdrify.benhouston3d.com/logo192.png" alt="HDRify logo" width="192" height="192">

[![NPM Package][npm]][npm-url]
[![NPM Downloads][npm-downloads]][npmtrends-url]
[![Tests][tests-badge]][tests-url]
[![Coverage][coverage-badge]][coverage-url]

CLI for converting and inspecting EXR, HDR, and JPEG gain map (Ultra HDR / Adobe) files. Convert to highly compressible JPEG-R (JPEG with gain maps) for efficient HDR storage. Powered by [hdrify](https://www.npmjs.com/package/hdrify).

An **online demo** (the web-converter from this repository) is available at **[https://hdrify.benhouston3d.com](https://hdrify.benhouston3d.com)** — an HDR, EXR, and Ultra HDR (JPEG-R) format viewer and converter; try it in your browser without installing the CLI.

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
hdrify convert input.exr output.ultrahdr.jpg    # JPEG-R with gain map (Ultra HDR, default)
hdrify convert input.exr output.gainmap.jpg --format adobe-gainmap   # Adobe gain map format
hdrify convert input.jpg output.exr    # Read JPEG gain map (Ultra HDR or Adobe) as input
hdrify convert input.exr output.webp   # Tonemaps the HDR during conversion to SDR webp format

# View file metadata
hdrify info input.exr
hdrify info input.hdr
hdrify info input.jpg    # JPEG gain map (Ultra HDR / Adobe)

# Create synthetic reference image
hdrify reference output.exr
hdrify reference output.hdr --compression zip
```

## Options

Key flags for `convert`: `--compression` (EXR output only: none, rle, zip, zips, piz), `--format` (JPEG output only: ultrahdr, adobe-gainmap; default: ultrahdr), `--tonemapping` (aces, reinhard, neutral, agx), `--exposure`, `--quality` (JPEG). Run `hdrify --help` for full usage.

## Library

For programmatic use, install the [hdrify](https://www.npmjs.com/package/hdrify) library.

## License

MIT

## Author

Ben Houston <neuralsoft@gmail.com> (https://benhouston3d.com), Sponsored by [Land of Assets](https://landofassets.com)

[npm]: https://img.shields.io/npm/v/hdrify-cli
[npm-url]: https://www.npmjs.com/package/hdrify-cli
[npm-downloads]: https://img.shields.io/npm/dw/hdrify-cli
[npmtrends-url]: https://www.npmtrends.com/hdrify-cli
[tests-badge]: https://github.com/bhouston/hdrify/workflows/Tests/badge.svg
[tests-url]: https://github.com/bhouston/hdrify/actions/workflows/test.yml
[coverage-badge]: https://codecov.io/gh/bhouston/hdrify/branch/main/graph/badge.svg
[coverage-url]: https://codecov.io/gh/bhouston/hdrify
