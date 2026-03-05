# hdrify-react

<img src="https://hdrify.benhouston3d.com/logo192.png" alt="HDRify logo" width="192" height="192">

[![NPM Package][npm]][npm-url]
[![NPM Downloads][npm-downloads]][npmtrends-url]
[![Tests][tests-badge]][tests-url]
[![Coverage][coverage-badge]][coverage-url]

React component for displaying HDR images from [hdrify](https://www.npmjs.com/package/hdrify). Accepts `HdrifyImage` (returned by `readHdr`, `readExr`, `readJpegGainMap`) and renders with configurable tone mapping and exposure.

**Related packages:** [hdrify](https://www.npmjs.com/package/hdrify) (core library) · [hdrify-cli](https://www.npmjs.com/package/hdrify-cli) (CLI tool)

An **online demo** is available at **[https://hdrify.benhouston3d.com](https://hdrify.benhouston3d.com)** — HDR, EXR, and Ultra HDR viewer and converter built with this component; try it in your browser.

## Installation

```sh
pnpm add hdrify-react hdrify
```

## Usage

```tsx
import { HdrifyCanvas, type HdrifyImage } from 'hdrify-react';
import { readExr } from 'hdrify';

const hdrifyImage: HdrifyImage = readExr(buffer);

<HdrifyCanvas
  hdrifyImage={hdrifyImage}
  toneMapping="neutral"
  exposure={1.0}
  className="max-w-full"
/>
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `hdrifyImage` | `HdrifyImage` | Image from `readHdr`, `readExr`, or `readJpegGainMap` |
| `toneMapping` | `'aces' \| 'reinhard' \| 'neutral' \| 'agx'` | Tone mapper to use |
| `exposure` | `number` | Exposure value (1.0 = nominal) |
| `className` | `string` | Optional CSS class for the canvas |
| `forwardedRef` | `RefObject<HTMLCanvasElement \| null>` | Optional ref for canvas access (e.g. `toBlob`) |

## License

MIT

## Author

[Ben Houston](https://benhouston3d.com), Sponsored by [Land of Assets](https://landofassets.com)

[npm]: https://img.shields.io/npm/v/hdrify-react
[npm-url]: https://www.npmjs.com/package/hdrify-react
[npm-downloads]: https://img.shields.io/npm/dw/hdrify-react
[npmtrends-url]: https://www.npmtrends.com/hdrify-react
[tests-badge]: https://github.com/bhouston/hdrify/workflows/Tests/badge.svg
[tests-url]: https://github.com/bhouston/hdrify/actions/workflows/test.yml
[coverage-badge]: https://codecov.io/gh/bhouston/hdrify/branch/main/graph/badge.svg
[coverage-url]: https://codecov.io/gh/bhouston/hdrify
