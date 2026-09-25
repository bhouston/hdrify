# hdrify-cli

<img src="https://hdrify.ben3d.ca/logo192.png" alt="HDRify logo" width="192" height="192">

[![NPM Package][npm]][npm-url]
[![NPM Downloads][npm-downloads]][npmtrends-url]
[![Tests][tests-badge]][tests-url]
[![Coverage][coverage-badge]][coverage-url]
[![Discord][discord-badge]][discord-url]

CLI for converting and inspecting EXR, HDR, and JPEG gain map (Ultra HDR / Adobe) files. Convert to highly compressible JPEG-R (JPEG with gain maps) for efficient HDR storage. Powered by [hdrify](https://www.npmjs.com/package/hdrify).

**Related packages:** [hdrify](https://www.npmjs.com/package/hdrify) (core library) · [hdrify-react](https://www.npmjs.com/package/hdrify-react) (React component)

An **online demo** is available at **[https://hdrify.ben3d.ca](https://hdrify.ben3d.ca)** — HDR, EXR, and Ultra HDR viewer and converter; try it in your browser without installing the CLI.

## Installation

```sh
pnpm add -g hdrify-cli
```

## Usage

| Command                           | Description                                                  |
| --------------------------------- | ------------------------------------------------------------ |
| `hdrify convert <input> <output>` | Convert between EXR, HDR, JPEG gain map, PNG, WebP, and JPEG |
| `hdrify info <file>`              | Display metadata (format, dimensions, compression)           |
| `hdrify reference <output>`       | Create synthetic reference test images                       |

```bash
# Convert between formats
hdrify convert input.exr output.hdr
hdrify convert input.hdr output.exr --compression piz
hdrify convert input.exr output.jpg    # JPEG-R with gain map (Ultra HDR, default)
hdrify convert input.exr output.jpg --format adobe-gainmap
hdrify convert input.jpg output.exr    # Read JPEG gain map as input
hdrify convert input.exr output.webp   # Tonemaps to SDR
hdrify convert input.exr output.exr --size 1024,512    # Resize (lanczos by default)
hdrify convert input.exr output.png --size 512 --filter bilinear  # Square, bilinear
hdrify convert input.exr output.exr --flip -1,1        # Mirror horizontally
hdrify convert input.exr output.exr --flip 1,-1        # Mirror vertically

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

**convert:** `--compression` (EXR: none, rle, zip, zips, piz, pxr24, b44, b44a, dwaa, dwab), `--format` (JPEG: ultrahdr, adobe-gainmap), `--tonemapping`, `--exposure`, `--quality`, `--size` (`WIDTH,HEIGHT` or `SIZE` for a square), `--filter` (resize filter: nearest, bilinear, lanczos; default: lanczos), `--flip` (`X,Y`, each `1` or `-1`, e.g. `-1,1` to mirror horizontally)

**reference:** `--type` (rainbow, cie-wedge, cie-wedge-r, cie-wedge-g, cie-wedge-b, gradient), `--compression`, `--width`, `--height`

Run `hdrify --help` for full usage.

## License

MIT

## Author

[Ben Houston](https://ben3d.ca), Sponsored by [Land of Assets](https://landofassets.com)

[npm]: https://img.shields.io/npm/v/hdrify-cli
[npm-url]: https://www.npmjs.com/package/hdrify-cli
[npm-downloads]: https://img.shields.io/npm/dw/hdrify-cli
[npmtrends-url]: https://www.npmtrends.com/hdrify-cli
[tests-badge]: https://github.com/bhouston/hdrify/workflows/Tests/badge.svg
[tests-url]: https://github.com/bhouston/hdrify/actions/workflows/test.yml
[coverage-badge]: https://codecov.io/gh/bhouston/hdrify/branch/main/graph/badge.svg
[coverage-url]: https://codecov.io/gh/bhouston/hdrify
[discord-badge]: https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white
[discord-url]: https://discord.gg/5J5Ur3F6Z2
