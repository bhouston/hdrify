# EXR RLE Implementation Comparison

Comparison of our `readExr` RLE support with reference implementations (FFmpeg, OpenEXR) to identify discrepancies causing `rainbow.exr` to fail.

## 1. RLE Decompression: Post-Processing Pipeline

**FFmpeg** ([exr.c:rle_uncompress](https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/exr.c)):

```c
static int rle_uncompress(const EXRContext *ctx, const uint8_t *src, ...) {
    rle(td->tmp, src, compressed_size, uncompressed_size);   // 1. Raw RLE
    ctx->dsp.predictor(td->tmp, uncompressed_size);          // 2. Predictor (delta decode)
    ctx->dsp.reorder_pixels(td->uncompressed_data, td->tmp, uncompressed_size);  // 3. Reorder
    return 0;
}
```

**slint/exr** ([rle.rs](https://codebrowser.dev/slint/crates/exr/src/compression/rle.rs.html)):

```rust
// After decompress_bytes():
differences_to_samples(&mut decompressed);   // Predictor
interleave_byte_blocks(&mut decompressed);   // Reorder
```

**Our implementation**: We only do raw RLE decompression. We do **not** apply:

- **Predictor** – OpenEXR RLE (and ZIP) store delta-encoded data; the predictor reverses that.
- **Reorder** – Converts from channel-planar to pixel-interleaved layout.

As a result, even if we fix the offset/block parse, the decoded pixels will be wrong without these steps.

---

## 2. Offset Table and Block 1 Error

`rainbow.exr` fails with:

```
scanline block 1 has invalid data size (1852138866 bytes, 405 available)
```

`1852138866` = `0x6E6E6E72` = ASCII `"nnnr"`, which strongly suggests we are reading chunk headers from the wrong place (e.g. from pixel data).

### Header End and Offset Table Start

From the [OpenEXR File Layout](https://openexr.com/en/latest/OpenEXRFileLayout.html):

> For single-part files: "the single null byte that signals the end of the headers must be **omitted**."

So for single-part scanline files there is no terminating null. Our logic:

```typescript
const attributeName = readNullTerminatedString(exrBuffer, offset);
offset += attributeName.length + 1;  // +1 skips the null we hit
if (attributeName === '') break;
```

If the byte after the last attribute is `0x00` (e.g. first byte of the offset table), we treat it as an empty attribute name and advance by 1. That skips the first byte of the offset table, shifting all offset reads by one byte. That can make `offset[1]` point into pixel data instead of the next block header.

### Offset Table Size

For RLE, `scan_lines_per_block = 1`, so we expect `height` blocks and `height` offsets. Our `maxOffsets` is:

```javascript
const maxOffsets = compression === PIZ_COMPRESSION ? expectedBlockCount : Math.max(expectedBlockCount, height);
```

For RLE this is correct (height entries). If the file actually uses a different layout (e.g. one block with all scanlines), we would read extra “offsets” from pixel data, which would explain the garbage `dataSize`.

### Raw Layout of `rainbow.exr` (740 bytes)

- `0x1a0`: `00 95 01 00 00 00 00 00` – first offset like `0x19500` (103,680) if read as uint64 LE, which is > 740.
- If we skip one byte before the offset table: first offset could be `95 01 00 00 00 00 00 00` = 405, which is plausible.
- The second offset then falls inside pixel data, producing values like `0x6E6E6E72`.

So the main issues are:

1. **Header end handling** – Possibly advancing one byte too many before the offset table for single-part files.
2. **Possible non-standard layout** – File might use fewer blocks or a different layout than we assume.

---

## 3. Summary of Discrepancies

| Area | Our Implementation | Reference (FFmpeg/slint) | Impact |
|------|--------------------|---------------------------|--------|
| RLE post-processing | Raw RLE only | RLE → predictor → reorder | Pixels wrong even if parse succeeds |
| Header end / offset start | Skip 1 byte when seeing empty name | Single-part omits null; may need different handling | Offset table misaligned; block 1 reads from pixel data |
| Predictor | Not implemented | Used for ZIP and RLE | Same delta decoding as ZIP |
| Reorder | Not implemented | Channel-planar → interleaved | Wrong pixel layout |

---

## 4. Recommended Fixes

1. **Match FFmpeg’s RLE pipeline**  
   After raw RLE decompression, add:
   - Predictor (same as ZIP; we likely already have or can reuse ZIP logic).
   - Reorder from channel-planar to pixel-interleaved (same as ZIP).

2. **Header / offset table alignment**  
   - For single-part scanline files, do not assume a null byte between header and offset table.
   - Avoid advancing past the first byte of the offset table when detecting end of header.

3. **Validate offset table**  
   - Reject offsets that are beyond the file size or clearly invalid.
   - Consider falling back or erroring if the number of blocks does not match expectations.

4. **Test with reference files**  
   Use known-good RLE EXRs (e.g. from OpenEXR’s test images) to validate both parsing and pixel decoding.
