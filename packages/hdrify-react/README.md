<p align="center">
  <a href="https://hdrify.ben3d.ca" target="_blank" rel="noopener noreferrer">
    <img alt="hdrify-react logo" src="https://raw.githubusercontent.com/bhouston/hdrify/main/packages/hdrify-vscode-extension/images/icon.png" height="96">
  </a>
</p>
<br/>
<p align="center">
  <a href="https://npmjs.com/package/hdrify-react"><img src="https://img.shields.io/npm/v/hdrify-react.svg" alt="npm package"></a>
  <a href="https://www.npmtrends.com/hdrify-react"><img src="https://img.shields.io/npm/dw/hdrify-react.svg" alt="npm downloads"></a>
  <a href="https://codecov.io/gh/bhouston/hdrify"><img src="https://codecov.io/gh/bhouston/hdrify/branch/main/graph/badge.svg" alt="coverage"></a>
  <a href="https://discord.gg/5J5Ur3F6Z2"><img src="https://img.shields.io/badge/chat-discord-blue?style=flat&logo=discord" alt="discord chat"></a>
  <a href="https://hdrify.ben3d.ca"><img src="https://img.shields.io/badge/docs-read-blue?style=flat" alt="documentation"></a>
</p>
<br/>

# hdrify-react

> Display HDR images in React with configurable tone mapping.

- 🖼️ `<image-viewer>` Web Component and `ImageViewer` React Component
- ⚛️ React Canvas Component
- 🎨 Four Tone Mappers
- ☀️ Adjustable Exposure
- 🖼️ Works With hdrify Readers
- 🔷 Typed Props

React component for displaying HDR images from [hdrify](https://www.npmjs.com/package/hdrify). Accepts `HdrifyImage` (returned by `readHdr`, `readExr`, `readJpegGainMap`) and renders with configurable tone mapping and exposure.

**Related packages:** [hdrify](https://www.npmjs.com/package/hdrify) (core library) · [hdrify-cli](https://www.npmjs.com/package/hdrify-cli) (CLI tool)

An **online demo** is available at **[https://hdrify.ben3d.ca](https://hdrify.ben3d.ca)** — HDR, EXR, and Ultra HDR viewer and converter built with this component; try it in your browser.

[Read the Docs to Learn More](https://hdrify.ben3d.ca/).

## Installation

```sh
pnpm add hdrify-react hdrify
```

## Usage

```tsx
import { HdrifyCanvas, type HdrifyImage } from 'hdrify-react';
import { readExr } from 'hdrify';

const hdrifyImage: HdrifyImage = readExr(buffer);

<HdrifyCanvas hdrifyImage={hdrifyImage} toneMapping="neutral" exposure={1.0} className="max-w-full" />;
```

### Image viewer

`ImageViewer` loads an EXR, HDR or gain map JPEG (detected from its content, gzip allowed) and adds an options panel and an optional vertical exposure slider:

```tsx
import { ImageViewer } from 'hdrify-react';

<ImageViewer src="/images/memorial.exr" exposureControl toneMapping="agx" style={{ height: 600 }} />;
```

The same viewer is available as a web component for plain HTML and other frameworks:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/hdrify-react/dist/image-viewer.js"></script>
<image-viewer src="/images/memorial.exr" exposure-control></image-viewer>
```

While loading, a progress bar fills across the top (`onProgress` / the `progress` event report it). `whenReady()` and `toBlob()` (on the element, or on the component's `ref`) wait for the image and export the tone-mapped result.

With a bundler, `import 'hdrify-react/element'` instead. See the [`<image-viewer>` documentation](https://hdrify.ben3d.ca/docs/image-viewer/) for all attributes, events and theming.

### HdrifyCanvas props

| Prop           | Type                                         | Description                                           |
| -------------- | -------------------------------------------- | ----------------------------------------------------- |
| `hdrifyImage`  | `HdrifyImage`                                | Image from `readHdr`, `readExr`, or `readJpegGainMap` |
| `toneMapping`  | `'aces' \| 'reinhard' \| 'neutral' \| 'agx'` | Tone mapper to use                                    |
| `exposure`     | `number`                                     | Exposure value (1.0 = nominal)                        |
| `className`    | `string`                                     | Optional CSS class for the canvas                     |
| `forwardedRef` | `RefObject<HTMLCanvasElement \| null>`       | Optional ref for canvas access (e.g. `toBlob`)        |

## Contribution

See [Contributing Guide](https://github.com/bhouston/hdrify/blob/main/CONTRIBUTING.md).

## License

MIT

## Author

[Ben Houston](https://ben3d.ca), Sponsored by [Land of Assets](https://landofassets.com).
