import { describe, expect, it } from 'vitest';
import { compressRleBlock } from './compressRle.js';
import { EXR_COMPRESSION_CODES, HALF } from './exrConstants.js';
import { DEFAULT_CHANNELS } from './exrHeaderBuilder.js';
import { readExr } from './readExr.js';
import { writeExr } from './writeExr.js';
import { writeExrScanBlock } from './writeExrScanBlock.js';

// OpenEXRFileLayout: store compressed or uncompressed pixels, whichever is smaller.
// Readers identify raw chunks by size, so an expanded (or equal-size) encoded
// payload cannot be distinguished from raw half floats.
describe('EXR raw chunk fallback', () => {
  for (const [compression, code] of Object.entries(EXR_COMPRESSION_CODES)) {
    if (compression === 'none') continue;
    it(`${compression} stores a tiny expanding block as original half floats`, () => {
      const image = {
        width: 1,
        height: 1,
        data: new Float32Array([0.25, 0.5, 0.75, 1]),
        linearColorSpace: 'linear-rec709' as const,
      };
      const channels = DEFAULT_CHANNELS.map((ch) => ({ ...ch, pixelType: HALF }));
      const block = writeExrScanBlock({ hdrifyImage: image, firstLineY: 0, lineCount: 1, compression: code, channels });
      expect(new DataView(block.buffer).getUint32(4, true)).toBe(8);
      // DEFAULT_CHANNELS is RGBA: 0.25, 0.5, 0.75, 1 in little-endian HALF.
      expect(Array.from(block.subarray(8))).toEqual([0, 0x34, 0, 0x38, 0, 0x3a, 0, 0x3c]);
      expect(readExr(writeExr(image, { compression: code })).data).toEqual(image.data);
    });
  }

  it('stores raw pixels when RLE is exactly the same size as the input', () => {
    const raw = new Uint8Array([0, 0, 0, 0x2c, 0, 0, 0, 0x3c]);
    expect(compressRleBlock(raw).length).toBe(raw.length);
    const block = writeExrScanBlock({
      hdrifyImage: {
        width: 1,
        height: 1,
        data: new Float32Array([0, 0.0625, 0, 1]),
        linearColorSpace: 'linear-rec709',
      },
      firstLineY: 0,
      lineCount: 1,
      compression: EXR_COMPRESSION_CODES.rle,
      channels: DEFAULT_CHANNELS.map((ch) => ({ ...ch, pixelType: HALF })),
    });
    expect(block.subarray(8)).toEqual(raw);
  });
});
