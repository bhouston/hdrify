---
title: React
sidebar_position: 4
---

# React previews

`hdrify-react` provides two components:

- `ImageViewer`, a complete viewer that loads a file, detects its format, and adds an options panel and an optional exposure slider. It is the React form of the [`<image-viewer>` element](./image-viewer.mdx); see that page for its options.
- `HdrifyCanvas`, a canvas component that tone maps an already decoded `HdrifyImage`. Your application controls loading, errors, exposure, and tone mapping. The rest of this page covers it.

```sh
npm install hdrify hdrify-react
```

## A complete viewer component

This example loads an HDR file, reports loading errors, and lets the user adjust exposure in stops. Place the file at a URL served by your application, then render `<HdrViewer url="/images/environment.hdr" />`.

```tsx
import { readHdr, type HdrifyImage } from 'hdrify';
import { HdrifyCanvas } from 'hdrify-react';
import { useEffect, useState } from 'react';

export function HdrViewer({ url }: { url: string }) {
  const [image, setImage] = useState<HdrifyImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stops, setStops] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setImage(null);
    setError(null);

    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!controller.signal.aborted) setImage(readHdr(bytes));
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [url]);

  if (error) return <p role="alert">Could not load image: {error}</p>;
  if (!image) return <p>Loading HDR image…</p>;

  return (
    <div>
      <label>
        Exposure: {stops} stops
        <input
          type="range"
          min={-4}
          max={4}
          step={0.25}
          value={stops}
          onChange={(event) => setStops(Number(event.target.value))}
        />
      </label>
      <HdrifyCanvas hdrifyImage={image} toneMapping="aces" exposure={2 ** stops} className="hdr-preview" />
    </div>
  );
}
```

```css
.hdr-preview {
  display: block;
  max-width: 100%;
  height: auto;
}
```

For EXR or gain map JPEG input, replace `readHdr` with `readExr` or `readJpegGainMap`.

## Component props

| Prop           | Required | Purpose                                                                                    |
| -------------- | -------- | ------------------------------------------------------------------------------------------ |
| `hdrifyImage`  | Yes      | Decoded linear floating point RGBA image                                                   |
| `toneMapping`  | No       | `none`, `aces`, `reinhard`, `neutral`, or `agx`; defaults to None for HDR, Neutral for SDR |
| `exposure`     | Yes      | Linear exposure multiplier; `1` is unchanged                                               |
| `className`    | No       | Class applied to the canvas wrapper                                                        |
| `forwardedRef` | No       | React ref for access to the underlying canvas                                              |

The component renders opaque image pixels and redraws when the image reference, exposure, or tone mapper changes. Supply a new image object after changing pixels to trigger an update. HDR uses an extended FP16 WebGPU canvas sized for the displayed image and device pixel ratio; the 2D SDR fallback retains the source raster and scales it for display.

For a portable SDR preview, use `ImageViewer.toBlob()` or `captureImage()` rather than relying on serialization of the active GPU canvas. `forwardedRef` gives access to whichever canvas is active. Use the core HDR writers when exporting the original dynamic range.

See the generated [React API reference](/docs/api/react) for the current prop definitions, and the [live demo](pathname:///hdrify/demo/) for an interactive viewer and converter.

The canvas automatically selects Three.js WebGPU only on an HDR-capable display with acknowledged extended FP16 presentation; otherwise it uses the existing 2D SDR canvas. It redraws when the viewport, source dimensions, or device pixel ratio changes and disposes GPU resources on unmount. `onDraw(image, mode)` reports a completed draw (`hdr` or `sdr`); `forwardedRef` follows the active canvas, including replacement during fallback.
