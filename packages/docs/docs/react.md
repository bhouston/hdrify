---
title: React
sidebar_position: 4
---

# React previews

`hdrify-react` provides `HdrifyCanvas`, a canvas component that tone maps an already decoded `HdrifyImage`. Your application controls loading, errors, exposure, and tone mapping.

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
      <HdrifyCanvas
        hdrifyImage={image}
        toneMapping="aces"
        exposure={2 ** stops}
        className="hdr-preview"
      />
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

| Prop | Required | Purpose |
| --- | --- | --- |
| `hdrifyImage` | Yes | Decoded linear floating point RGBA image |
| `toneMapping` | Yes | `aces`, `reinhard`, `neutral`, or `agx` |
| `exposure` | Yes | Linear exposure multiplier; `1` is unchanged |
| `className` | No | Class applied to the canvas |
| `forwardedRef` | No | React ref for access to the underlying canvas |

The component sizes its drawing buffer to the image dimensions and redraws when the image reference, exposure, or tone mapper changes. Supply a new image object after changing pixels to trigger an update. It renders an opaque, sRGB SDR preview through a 2D canvas; exporting that canvas produces the preview rather than the original HDR values.

For downloading a tone-mapped preview, pass `useRef<HTMLCanvasElement | null>(null)` as `forwardedRef` and call `ref.current?.toBlob(...)` from a user action. Use the core HDR writers when exporting the original dynamic range.

See the generated [React API reference](/docs/api/react) for the current prop definitions, and the [live demo](/demo/) for an interactive viewer and converter.
