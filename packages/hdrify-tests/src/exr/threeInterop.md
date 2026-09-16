# Compressed scanline report investigation

Tested against three.js 0.186.0 and the local reference OpenEXR library through
`oiiotool`. The reported RLE/ZIP/ZIPS row reversal is a texture convention:
EXRLoader writes every scanline to `height - 1 - y`, including uncompressed
images. Normalizing that convention preserves every pixel. No predictor or
scanline-order change is needed.

The tiny-PIZ corruption is real. `writeExrScanBlock` always stores the compressor
output, even when it is as large as or larger than the raw pixels. The
[OpenEXR file layout](https://openexr.com/en/latest/OpenEXRFileLayout.html#compressed-data)
requires storing whichever is smaller. The reference writer uses compressed
bytes only when strictly smaller; equal-size chunks must be raw too.
[EXRLoader](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/EXRLoader.js)
detects compression with `size < lines * bytesPerLine`, so expanded PIZ payloads
are interpreted as half-float pixels. The reference decoder accepted the
expanded PIZ files in this investigation, which explains why reference-decoder
round trips alone did not expose this writer defect.

`writeExr.rawFallback.test.ts` checks the exact raw bytes for all nine compressed
codecs and an equal-size RLE payload. `threeInterop.test.ts` independently decodes
single-row, short-block, partial-final-block, and multiple-full-block images,
checking every RGBA component with exactly representable HALF values.

Before the fix, the two suites have 14 failures and 16 passes: all ten raw-fallback
checks fail, as do all four PIZ interoperability cases. The uncompressed, RLE,
ZIP, and ZIPS interoperability cases pass.

Run after building the library (the interoperability tests use its public package):

```sh
pnpm --filter hdrify build
pnpm vitest run packages/hdrify/src/exr/writeExr.rawFallback.test.ts packages/hdrify-tests/src/exr/threeInterop.test.ts
```
