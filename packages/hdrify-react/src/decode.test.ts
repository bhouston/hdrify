import { gzipSync } from 'node:zlib';
import { createGradientImage, encodeGainMap, writeExr, writeHdr, writeJpegGainMap } from 'hdrify';
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

  it('rejects other files', async () => {
    await expect(decodeHdrifyImage(new TextEncoder().encode('GIF89a'))).rejects.toThrow(/Unsupported image/);
  });
});
