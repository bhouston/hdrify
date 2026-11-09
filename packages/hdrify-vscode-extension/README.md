<p align="center">
  <a href="https://hdrify.ben3d.ca" target="_blank" rel="noopener noreferrer">
    <img alt="HDRify VS Code Extension logo" src="https://raw.githubusercontent.com/bhouston/hdrify/main/packages/hdrify-vscode-extension/images/icon.png" height="96">
  </a>
</p>
<br/>
<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=benhouston3d.hdrify-vscode-extension"><img src="https://img.shields.io/open-vsx/v/benhouston3d/hdrify-vscode-extension.svg" alt="open vsx version"></a>
  <a href="https://open-vsx.org/extension/benhouston3d/hdrify-vscode-extension"><img src="https://img.shields.io/open-vsx/dt/benhouston3d/hdrify-vscode-extension.svg" alt="open vsx downloads"></a>
  <a href="https://codecov.io/gh/bhouston/hdrify"><img src="https://codecov.io/gh/bhouston/hdrify/branch/main/graph/badge.svg" alt="coverage"></a>
  <a href="https://discord.gg/5J5Ur3F6Z2"><img src="https://img.shields.io/badge/chat-discord-blue?style=flat&logo=discord" alt="discord chat"></a>
  <a href="https://hdrify.ben3d.ca"><img src="https://img.shields.io/badge/docs-read-blue?style=flat" alt="documentation"></a>
</p>
<br/>

# HDRify VS Code Extension

> Preview and convert EXR, HDR, JPEG XL, and Ultra HDR images in VS Code.

- 👁️ Built-in HDR Image Preview
- 🎚️ Exposure and Tone Mapper Controls
- 🔄 Convert to EXR, HDR, JPEG XL, Ultra HDR
- 📂 Batch Convert Multiple Files
- 📦 No External Tools Required
- 🧩 Works in VS Code and Cursor

A VS Code and Cursor extension that adds HDR image conversion and preview for EXR, HDR, JPEG XL, and UltraHDR Jpeg files using the [hdrify](https://www.npmjs.com/package/hdrify) library. No external dependencies (OpenImageIO, OpenEXR, etc) required.

## Installation

- **VS Code**: Install from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=benhouston3d.hdrify-vscode-extension).
- **Cursor**: Install from [Open VSX](https://open-vsx.org/extension/benhouston3d/hdrify-vscode-extension).

## Preview and convert

Open an `.exr`, `.hdr`, or `.jxl` file to preview it with exposure and tone-mapping controls. For an Ultra HDR JPEG, right-click and choose **Open with HDR Image Preview**.

![HDR Image Preview](https://raw.githubusercontent.com/bhouston/hdrify/main/packages/hdrify-vscode-extension/images/image-preview.webp)

Right-click one or more images and choose **Convert HDR Image** to export EXR, HDR, JPEG XL, or Ultra HDR JPEG.

Conversion replaces the original file by default. Enable **HDRify: Leave Original When Changing Format** in Settings to keep the source. Other output options are available under **HDRify** in Settings.

## Documentation

Full documentation for the extension is available [on the HDRify documentation website](https://hdrify.ben3d.ca/docs/vscode/), including supported formats, settings, and conversion details.

## Contribution

See [Contributing Guide](https://github.com/bhouston/hdrify/blob/main/CONTRIBUTING.md).

## License

MIT

## Author

[Ben Houston](https://ben3d.ca), Sponsored by [Land of Assets](https://landofassets.com).
