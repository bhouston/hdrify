# hdrify-react

React component for displaying HDR images from [hdrify](https://www.npmjs.com/package/hdrify). Accepts `HdrifyImage` (returned by `readHdr`, `readExr`, `readJpegGainMap`) and renders with configurable tone mapping and exposure.

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
