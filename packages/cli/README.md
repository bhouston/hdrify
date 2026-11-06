<p align="center">
  <a href="https://hdrify.ben3d.ca" target="_blank" rel="noopener noreferrer">
    <img alt="hdrify-cli logo" src="https://raw.githubusercontent.com/bhouston/hdrify/main/packages/hdrify-vscode-extension/images/icon.png" height="96">
  </a>
</p>
<br/>
<p align="center">
  <a href="https://npmjs.com/package/hdrify-cli"><img src="https://img.shields.io/npm/v/hdrify-cli.svg" alt="npm package"></a>
  <a href="https://www.npmtrends.com/hdrify-cli"><img src="https://img.shields.io/npm/dw/hdrify-cli.svg" alt="npm downloads"></a>
  <a href="https://codecov.io/gh/bhouston/hdrify"><img src="https://codecov.io/gh/bhouston/hdrify/branch/main/graph/badge.svg" alt="coverage"></a>
  <a href="https://discord.gg/5J5Ur3F6Z2"><img src="https://img.shields.io/badge/chat-discord-blue?style=flat&logo=discord" alt="discord chat"></a>
  <a href="https://hdrify.ben3d.ca"><img src="https://img.shields.io/badge/docs-read-blue?style=flat" alt="documentation"></a>
</p>
<br/>

# hdrify-cli

> Convert and inspect EXR, HDR, and Ultra HDR files from the terminal.

- 🔄 Convert EXR, HDR, and Gain Maps
- 📸 Ultra HDR and Adobe Gain Map Output
- 🔍 Inspect File Metadata
- 📐 Resize and Flip Images
- 🎨 Tone Map to PNG, WebP, JPEG
- 🧪 Generate Reference Test Images

CLI for converting and inspecting EXR, HDR, and JPEG gain map (Ultra HDR / Adobe) files. Convert to highly compressible JPEG-R (JPEG with gain maps) for efficient HDR storage. Powered by [hdrify](https://www.npmjs.com/package/hdrify).

**Related packages:** [hdrify](https://www.npmjs.com/package/hdrify) (core library) · [hdrify-react](https://www.npmjs.com/package/hdrify-react) (React component)

An **online demo** is available at **[https://hdrify.ben3d.ca](https://hdrify.ben3d.ca)** — HDR, EXR, and Ultra HDR viewer and converter; try it in your browser without installing the CLI.

[Read the Docs to Learn More](https://hdrify.ben3d.ca/).

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

## Contribution

See [Contributing Guide](https://github.com/bhouston/hdrify/blob/main/CONTRIBUTING.md).

## License

MIT

## Author

[Ben Houston](https://ben3d.ca), Sponsored by [Land of Assets](https://landofassets.com).
