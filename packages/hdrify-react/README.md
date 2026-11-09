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

React component for displaying HDR images from [hdrify](https://www.npmjs.com/package/hdrify). Accepts `HdrifyImage` (returned by `readHdr`, `readExr`, `readJxl`, `readJpegGainMap`) and renders with configurable tone mapping and exposure.

**Related packages:** [hdrify](https://www.npmjs.com/package/hdrify) (core library) · [hdrify-cli](https://www.npmjs.com/package/hdrify-cli) (CLI tool)

Try the **[online demo](https://hdrify.ben3d.ca/demo/)** — HDR, EXR, and Ultra HDR viewer and converter built with this component; try it in your browser.

## Installation

```sh
pnpm add hdrify-react hdrify
```

## Usage

```tsx
import { HdrifyCanvas, type HdrifyImage } from 'hdrify-react';
import { readExr } from 'hdrify';

const hdrifyImage: HdrifyImage = readExr(buffer);

<HdrifyCanvas hdrifyImage={hdrifyImage} exposure={1.0} className="max-w-full" />;
```

See [`HdrifyCanvas`](https://hdrify.ben3d.ca/docs/api/react/functions/HdrifyCanvas/) and [`HdrifyCanvasProps`](https://hdrify.ben3d.ca/docs/api/react/interfaces/HdrifyCanvasProps/) for rendering behavior and props.

### Image viewer

`ImageViewer` loads an EXR, HDR, JPEG XL or gain map JPEG (detected from its content, gzip allowed) and adds an options panel and an optional vertical exposure slider:

```tsx
import { ImageViewer } from 'hdrify-react';

<ImageViewer src="/images/memorial.exr" exposureControl toneMapping="agx" style={{ height: 600 }} />;
```

The same viewer is available as a web component for plain HTML and other frameworks:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/hdrify-react/dist/image-viewer.js"></script>
<image-viewer src="/images/memorial.exr" exposure-control></image-viewer>
```

API reference: [`ImageViewer`](https://hdrify.ben3d.ca/docs/api/react/functions/ImageViewer/) · [`ImageViewerProps`](https://hdrify.ben3d.ca/docs/api/react/interfaces/ImageViewerProps/) · [`ImageViewerHandle`](https://hdrify.ben3d.ca/docs/api/react/interfaces/ImageViewerHandle/).

With a bundler, `import 'hdrify-react/element'` to register the web component.

## Documentation

Full documentation for the React components is available [on the HDRify documentation website](https://hdrify.ben3d.ca/docs/react/). See the [React guide](https://hdrify.ben3d.ca/docs/react/) and [`<image-viewer>` documentation](https://hdrify.ben3d.ca/docs/image-viewer/) for loading, capture, attributes, events, and theming.

## Contribution

See [Contributing Guide](https://github.com/bhouston/hdrify/blob/main/CONTRIBUTING.md).

## License

MIT

## Author

[Ben Houston](https://ben3d.ca), Sponsored by [Land of Assets](https://landofassets.com).

Compare browser behavior at [hdr-capabilities.ben3d.ca](https://hdr-capabilities.ben3d.ca), maintained in the separate [hdr-capabilities repository](https://github.com/bhouston/hdr-capabilities).
