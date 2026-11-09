import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createGradientImage, encodeGainMap, writeExr, writeHdr, writeJpegGainMap, readJxl, writeJxl } from 'hdrify';
import { describe, expect, it } from 'vitest';
import { decodeHdrifyImage } from './decode.js';

const image = createGradientImage({ width: 8, height: 4, mode: 'horizontal', min: 0, max: 4 });

describe('decodeHdrifyImage', () => {
  it.each([
    ['OpenEXR', writeExr(image)],
    ['Radiance HDR', writeHdr(image)],
    ['JPEG gain map', writeJpegGainMap(encodeGainMap(image))],
    ['gzipped HDR', gzipSync(writeHdr(image))],
  ])('detects %s from its content', async (_name, bytes) => {
    const decoded = await decodeHdrifyImage(new Uint8Array(bytes));
    expect([decoded.width, decoded.height]).toEqual([8, 4]);
  });

  it.each(['lossless_rgb8.jxl', 'lossless_rgb8_container.jxl', 'lossless_float32.jxl', 'vardct_float.jxl'])(
    'decodes %s by content with matching pixels and metadata',
    async (name) => {
      const bytes = readFileSync(new URL(`../../../assets/jxl/${name}`, import.meta.url));
      const expected = readJxl(bytes);
      // Include a nonzero byte offset, as with a file embedded in a larger buffer.
      const padded = new Uint8Array(bytes.length + 7);
      padded.set(bytes, 7);
      expect(await decodeHdrifyImage(padded.subarray(7))).toEqual(expected);
      expect(await decodeHdrifyImage(Uint8Array.from(bytes).buffer)).toEqual(expected);
    },
  );

  it.each([false, true])('decodes lossy JXL with container=%s', async (container) => {
    const bytes = writeJxl(image, { lossy: true, container });
    expect(await decodeHdrifyImage(bytes)).toEqual(readJxl(bytes));
  });

  it('decompresses gzipped JXL before detecting its format', async () => {
    const bytes = writeJxl(image);
    expect(await decodeHdrifyImage(gzipSync(bytes))).toEqual(readJxl(bytes));
  });

  it('reports malformed JXL as a decode error', async () => {
    await expect(decodeHdrifyImage(new Uint8Array([0xff, 0x0a]))).rejects.toThrow();
  });

  it('rejects other files', async () => {
    await expect(decodeHdrifyImage(new TextEncoder().encode('GIF89a'))).rejects.toThrow(/Unsupported image/);
  });
});
