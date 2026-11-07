# HDR rendering comparison prototype

Issue: https://github.com/bhouston/hdrify/issues/213

This experiment compares Canvas 2D, WebGPU, and native HDR images before changing `HdrifyCanvas` or `<image-viewer>`. It does not change either public component. Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium firefox webkit
pnpm dev:hdr-canvas
# Open http://127.0.0.1:4178
pnpm test:hdr-canvas
```

The page compares linear Display P3, linear sRGB, encoded Display P3, and encoded sRGB FP16 Canvas 2D surfaces, a WebGPU renderer, and native HDR images with the current Neutral SDR transform. It includes reference patches at 0, 0.18, 0.5, 1, 2, and 4, exposure controls, and the repository's `memorial.hdr` image. It displays acknowledged capabilities independently of requested settings.

## Observed results — November 7, 2026

Headed Playwright 1.65.0 on macOS, Apple M3. WebGL diagnostics identified `ANGLE Metal Renderer: Apple M3` in Chromium, `Apple GPU` in WebKit, and Firefox's privacy-reduced `Apple M1, or similar`. No software rasterizers were used. These diagnostics establish the available graphics renderer; they do not prove that every Canvas 2D operation executes on the GPU.

| Browser                                              | FP16 upload and readback                               | Linear color spaces | Extended 2D presentation acknowledged                      |
| ---------------------------------------------------- | ------------------------------------------------------ | ------------------- | ---------------------------------------------------------- |
| Chrome 156.0.8078.80                                 | Yes                                                    | No                  | No; reports `standard`                                     |
| Chromium 158.0.8127.18                               | Yes                                                    | Yes                 | No; reports `standard`                                     |
| Chromium 158 with experimental web platform features | Yes                                                    | Yes                 | Yes, after `configureHighDynamicRange({mode: 'extended'})` |
| Playwright WebKit 27.2                               | No in default configuration                            | Yes                 | No                                                         |
| Playwright Firefox 159.0                             | No in default configuration                            | No                  | No                                                         |
| Actual Safari 27.2                                   | SafariDriver could not establish an automation session | Not established     | Not established                                            |

Playwright WebKit is a separate build, not the installed Safari application. SafariDriver was attempted independently and timed out connecting to Safari; no successful native Safari result is claimed. Use the separate runner to retry on a machine with working Safari automation:

```sh
safaridriver --port 4447
# In another terminal:
pnpm test:hdr-canvas:safari
```

The Safari runner records native capabilities and a diagnostic screenshot. The Playwright matrix additionally runs numerical exposure, source preservation, destination sanitization, and image-loading tests. Unsupported contexts are reported explicitly, not treated as successful HDR rendering.

Chrome/Chromium and WebKit reported HDR/P3 display capability on this machine. Firefox reported neither. Crucially, Playwright normally launches Chromium with `--force-color-profile=srgb`. The test removes that argument; leaving it in place hides the display's actual HDR/gamut capabilities. No HDR media query is emulated.

## WebGPU results

The renderer uses a full-screen triangle, source linear RGBA in a GPU storage buffer, an exposure uniform, and an `rgba16float` canvas with `toneMapping: {mode: 'extended'}`. It prefers linear color-space tags and explicitly encodes the extended sRGB transfer function when only an encoded destination is supported. This prototype's WebGPU output is opaque; production alpha/compositing policy is not implemented.

| Browser                   | Adapter           | Canvas encoding                       | Extended configuration | GPU readback at 0/±1 EV |
| ------------------------- | ----------------- | ------------------------------------- | ---------------------- | ----------------------- |
| Chrome 156                | Apple / Metal 3   | `display-p3` + shader encoding        | Acknowledged           | Passed                  |
| Chromium 158              | Apple / Metal 3   | `display-p3-linear`                   | Acknowledged           | Passed                  |
| Playwright WebKit 27.2    | Apple             | `display-p3-linear`                   | Acknowledged           | Passed                  |
| Firefox 159               | Adapter available | No FP16 canvas configuration accepted | Unavailable            | Unsupported             |
| Chromium 158 experimental | Apple / Metal 3   | `display-p3-linear`                   | Acknowledged           | Passed                  |

All 12 GPU readback/exposure cases passed. Readback is copied from the actual canvas texture to a staging buffer and mapped after GPU completion, rather than inferred from submitted shader inputs. The 0 EV linear output was `[0, 0.17993, 0.5, 1, 2, 4]`; +1 EV produced `[0, 0.35986, 1, 2, 4, 8]`. Chrome's encoded destination introduces the expected additional FP16 quantization error (maximum linear error 0.00843 at 8× white). This is correctness validation, not a throughput benchmark.

## Native image results

The **Transcode current view** button applies the current exposure to a copy of the source, encodes it, and displays native `<img>` elements. Native images are a snapshot: move the exposure slider and transcode again to update them. The prototype tests these candidates:

- Gain-map JPEG using HDRify's existing encoder, Neutral SDR base, quality 100.
- Lossless floating-point JPEG XL using HDRify's encoder with `bitDepth: 'float16'` and a container.
- A prototype 16-bit Rec.2020/PQ PNG writer, using 1.0 = 203 nits, a `cICP` chunk `[9,16,0,1]`, and the matching ICC profile from the existing logo. The writer uses browser `CompressionStream` and is experimental, not a new public HDRify encoder.

All three files decoded at the expected dimensions in every tested browser, including default Firefox and WebKit. This is **format decoding support**, not confirmation of HDR presentation.

Chrome/Chromium native JPEG XL decoding copied into an FP16 canvas preserved the known `[1,2,4]` patch values (Chrome 156's encoded canvas gave approximately `[1,1.99756,3.99705]`). The gain-map JPEG canvas copy gave approximately `[0.87109,0.95557,0.98193]`, and PQ PNG gave `[0.49927,0.74512,0.94336]`. Even the experimentally extended destination did not change those latter copy results. Browser image-to-canvas conversion can therefore apply different tone-mapping behavior; these numbers do not establish what native `<img>` composition does on the HDR display.

The npm README logo is `packages/hdrify-vscode-extension/images/icon.png`: **192×192, 8-bit RGBA PNG with an embedded ICC profile named “Rec2020 Gamut with PQ Transfer.”** Its HDR encoding is in the profile, not its bit depth. The page includes the original logo as a fourth native image for comparison. A 16-bit PQ transcode reduces quantization relative to using an 8-bit PQ PNG for arbitrary images.

Chrome now ships native JPEG XL decoding from version 155, and Firefox enabled JPEG XL in 158. These announcements establish decoder support, not identical HDR display behavior. Safari added HDR image presentation in 26; Firefox still has open gain-map and HDR still-image work. See the primary sources below.

## Pixel pipeline

1. Copy the source, replacing nonfinite samples without changing the original data.
2. Convert source linear primaries to Rec.709 or Display P3, retaining signed intermediate values.
3. Apply `2 ** exposureEV` in linear light.
4. For a linear-tagged destination, write the linear values. For an `srgb`/`display-p3` destination, apply the sign-preserving extended sRGB transfer function, without clamping to 1.
5. Store RGBA in a `Float16Array`; upload using `ImageData` with `pixelFormat: 'rgba-float16'` and the matching color-space tag.
6. Require acknowledged FP16 storage, matching color-space tags, and successful above-one readback. Report extended presentation separately.

The test verifies 0/±1 EV against known linear values, including 2/4/8× white, with FP16 tolerances. All 30 pixel/exposure cases passed across the three FP16-capable configurations. It also checks the exposure control, loads the actual HDR image, and rejects page errors in every browser.

`getContext('2d', {toneMapping: {mode: 'extended'}})` alone still reported `standard` in the tested Chromium versions. The experimental canvas-level configuration was needed to acknowledge extended mode. Passing an unknown dictionary member without an exception is not feature detection.

The prototype deliberately has no SDR tone mapper on its float surfaces. Very bright scene values may exceed physical display headroom. A production renderer also needs explicit source/reference-white normalization: arbitrary scene-linear EXR data and JPEG XL pixels normalized to `intensityTarget` do not share an automatic luminance interpretation. The sample is scene-relative; this experiment is not a reference-white solution for every decoded format.

## Screenshots

A compact, committed record is in [`observations.json`](./observations.json). The runner saves screenshots and numerical JSON results under `packages/hdrify-react/dist/hdr-canvas-results/` (ignored generated output).

Every Playwright screenshot in this run was an 8-bit PNG. Chromium screenshots contained no HDR color metadata. In both standard and experimentally extended 2D contexts, the displayed 1×/2×/4× white patches all became `[255,255,255,255]` in screenshot readback, although FP16 canvas readback retained distinct values. WebGPU and native JPEG XL screenshots also clipped these patches to white. Native JPEG/PNG screenshot appearance differed between engines. Playwright screenshots therefore cannot validate HDR highlights in this setup.

Use `getImageData(..., {pixelFormat: 'rgba-float16'})` to validate canvas pixels. That readback does not validate browser composition or physical display brightness. An HDR screenshot of composed content needs another capture mechanism: Apple's ScreenCaptureKit offers HDR screenshot presets and `SCCaptureDynamicRange`. That native capture path was researched, not implemented or tested here. A capture still does not measure emitted display luminance.

## Integration recommendation

For interactive exposure and precise pixel control, WebGPU has the strongest tested path: it acknowledges extended output and preserves the actual GPU canvas pixels without experimental flags in Chrome and WebKit. Default Firefox still has an FP16 presentation gap. This does not settle emitted display brightness; that remains to be verified independently.

Native images are the simplest candidate for static display. JPEG XL is particularly promising because the existing HDRify encoder retains float samples, all tested engines decode the output, and Chromium's decoder/canvas copy retains above-white values. Encoding and decoding again after every exposure change adds work, so a worker and debouncing would be appropriate for an interactive viewer. Gain-map JPEG offers an intentional SDR rendition, but is lossy and its metadata compatibility and display behavior need verification. PQ PNG follows the existing logo's approach, at higher bit depth, but needs an explicit luminance scale and observed different tone mapping between engines.

Keep Canvas 2D as an experimental backend for now: default Chrome lacks acknowledged extended presentation, and default WebKit/Firefox lack the required FP16 upload path. Do not label FP16 storage alone as HDR display output.

Any production integration should separate HDR rendering from SDR preview/capture, make source/reference-white interpretation explicit, and expose requested versus configured output state. The three approaches do not solve missing browser HDR output by themselves. Unsupported browsers should report unavailable HDR or deliberately render an SDR view.

Physical brighter-than-white output remains unverified. Actual Safari could not be automated in this session; its Playwright WebKit counterpart must not be substituted for a native Safari test result.

## Primary references

- [HTML Canvas color spaces and ImageData](https://html.spec.whatwg.org/multipage/canvas.html)
- [Canvas floating-point explainer: storage and HDR presentation are separate](https://raw.githubusercontent.com/w3c-cg/ColorWeb-CG/main/canvas_float.md)
- [Chromium Canvas 2D settings](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/canvas/canvas2d/canvas_rendering_context_2d_settings.idl)
- [Chromium canvas tone-mapping IDL; legacy experimental configuration](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/html/canvas/canvas_tone_mapping.idl)
- [Playwright browser support and WebKit/Safari distinction](https://playwright.dev/docs/browsers#webkit)
- [Playwright screenshot API](https://playwright.dev/docs/api/class-page#page-screenshot)
- [Apple: Capture HDR content with ScreenCaptureKit](https://developer.apple.com/videos/play/wwdc2024/10088/)
- [Apple: SCCaptureDynamicRange](https://developer.apple.com/documentation/screencapturekit/sccapturedynamicrange)

- [Chrome: JPEG XL shipped in 155](https://developer.chrome.com/blog/jpeg-xl-in-chrome)
- [Firefox 158 release notes: JPEG XL](https://www.firefox.com/en-US/firefox/158.0/releasenotes/)
- [WebKit: Safari 26 HDR images and dynamic-range-limit](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)
- [Mozilla: open JPEG gain-map support issue](https://bugzilla.mozilla.org/show_bug.cgi?id=1832622)
- [Mozilla: HDR still-image display tracking on Windows](https://bugzilla.mozilla.org/show_bug.cgi?id=1918773)
