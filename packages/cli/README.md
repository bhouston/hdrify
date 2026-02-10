# hdrify-cli

[![NPM Package][npm]][npm-url]
[![NPM Downloads][npm-downloads]][npmtrends-url]
[![Tests][tests-badge]][tests-url]
[![Coverage][coverage-badge]][coverage-url]

CLI for converting and inspecting EXR/HDR files, powered by [hdrify](https://www.npmjs.com/package/hdrify).

## Installation

```sh
pnpm add -g hdrify-cli
```

## Usage

| Command | Description |
| ------- | ----------- |
| `hdrify convert <input> <output>` | Convert between EXR, HDR, PNG, WebP, JPEG |
| `hdrify info <file>` | Display metadata (format, dimensions, compression) |
| `hdrify reference <output>` | Create synthetic reference test images |

```bash
# Convert between formats
hdrify convert input.exr output.hdr
hdrify convert input.hdr output.exr

# View file metadata
hdrify info input.exr
hdrify info input.hdr

# Create synthetic reference image
hdrify reference output.exr
hdrify reference output.hdr --compression zip
```

## Options

Key flags for `convert`: `--compression` (EXR: none, rle, zip, zips, piz), `--tonemapping` (aces, reinhard), `--exposure`, `--quality` (JPEG). Run `hdrify --help` for full usage.

## Library

For programmatic use, install the [hdrify](https://www.npmjs.com/package/hdrify) library.

## License

MIT

## Author

Ben Houston <neuralsoft@gmail.com> (https://benhouston3d.com)

[npm]: https://img.shields.io/npm/v/hdrify-cli
[npm-url]: https://www.npmjs.com/package/hdrify-cli
[npm-downloads]: https://img.shields.io/npm/dw/hdrify-cli
[npmtrends-url]: https://www.npmtrends.com/hdrify-cli
[tests-badge]: https://github.com/bhouston/hdrify/workflows/Tests/badge.svg
[tests-url]: https://github.com/bhouston/hdrify/actions/workflows/test.yml
[coverage-badge]: https://codecov.io/gh/bhouston/hdrify/branch/main/graph/badge.svg
[coverage-url]: https://codecov.io/gh/bhouston/hdrify
