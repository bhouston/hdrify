# HDRify VS Code Extension

![HDR Image Preview](/packages/hdrify-vscode-extension/images/icon.png)

A VS Code and Cursor extension that adds HDR image conversion and preview for EXR, HDR, and UltraHDR Jpeg files using the [hdrify](https://www.npmjs.com/package/hdrify) library.  No external dependencies (OpenImageIO, OpenEXR, etc) required.

**Author:** [Ben Houston](https://benhouston3d.com) | [GitHub](https://github.com/bhouston)

## HDR Image Preview

- **EXR and HDR**: Click any `.exr` or `.hdr` file in the Explorer to open it with the HDR Image Preview (default action). The preview shows metadata (width, height, file size, pixels, internal format), an exposure slider (0.1–10), and a tonemapper selector (Neutral, AgX, ACES).
- **JPEG**: For UltraHDR Jpeg files, right-click and choose **Open with HDR Image Preview**. Standard JPEGs open with the built-in viewer by default; use "Reopen Editor With → HDR Image Preview" to try opening as HDR (will show an error if not a gain-map JPEG).

![HDR Image Preview](/packages/hdrify-vscode-extension/images/image-preview.webp)

## Convert HDR Image

Right-click an EXR, HDR, or UltraHDR Jpeg in the Explorer. A **Convert HDR Image** submenu appears with:

- **Convert to EXR** — Output uses PIZ compression by default (configurable).
- **Convert to HDR** — Radiance RGBE format.
- **Convert to UltraHDR Jpeg** — JPEG with gain map (Ultra HDR / JPEG-R).

**Multi-select**: Select multiple files and right-click to convert all of them in one action. A progress indicator appears when processing two or more images.

## Supported Formats

| Format | Extension | Preview | Convert |
|--------|-----------|---------|---------|
| OpenEXR | `.exr` | Default | ✓ |
| Radiance HDR | `.hdr` | Default | ✓ |
| UltraHDR Jpeg | `.jpg`, `.jpeg` | Optional | ✓ |

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `hdrify.conversionQuality` | number | 90 | Quality for UltraHDR JPEG output (0–100) |
| `hdrify.leaveOriginalWhenChangingFormat` | boolean | false | When converting, leave the original file and write to a new file (same name, target extension) |
| `hdrify.exrCompression` | string | `"piz"` | Compression for EXR output: `none`, `rle`, `zips`, `zip`, `piz`, `pxr24` |

## Replace vs Save-As Behavior

By default, the extension **replaces** the existing file when converting (overwrites with the new format and deletes the original). Enable **Leave original when changing format** to write to new files instead.

## License

MIT

---

## Installation (for contributors)

- **VS Code**: Install from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/) (when published) or install from VSIX.
- **Cursor**: Install from [Open VSX](https://open-vsx.org/) (when published) or install from VSIX.

To install from VSIX: run `pnpm run package` in this directory, then use **Extensions: Install from VSIX...** and select the generated `.vsix` file.
