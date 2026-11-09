import { describe, expect, it } from 'vitest';
import { JxlBitReader } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import {
  type JxlEncBitDepth,
  type JxlEncLayout,
  writeFrameHeader,
  writeImageMetadata,
  writeSizeHeader,
  writeToc,
  wrapJxlContainer,
} from './jxlEncHeaders.js';
import { readFrameHeader, readToc } from './jxlFrameHeader.js';
import { readImageHeader } from './jxlImageHeader.js';

const F16: JxlEncBitDepth = { float: true, bitsPerSample: 16, expBits: 5 };
const F32: JxlEncBitDepth = { float: true, bitsPerSample: 32, expBits: 8 };
const U8: JxlEncBitDepth = { float: false, bitsPerSample: 8, expBits: 0 };
const layout = (alpha: boolean): JxlEncLayout => ({
  grey: false,
  orientation: 1,
  extraChannels: alpha ? [{ type: 'alpha' }] : [],
});

function headers(
  width: number,
  height: number,
  bitDepth: JxlEncBitDepth,
  alpha: boolean,
  space: 'linear-rec709' | 'linear-p3' | 'linear-rec2020' = 'linear-rec709',
  groupSizeShift = 1,
): JxlBitReader {
  const w = new JxlBitWriter();
  w.writeBits(8, 0xff);
  w.writeBits(8, 0x0a);
  writeSizeHeader(w, width, height);
  writeImageMetadata(w, bitDepth, layout(alpha), space);
  writeFrameHeader(w, alpha ? 1 : 0, groupSizeShift);
  return new JxlBitReader(w.finish());
}

describe('jxlEncHeaders', () => {
  it('writes sizes in every U32 range', () => {
    for (const [width, height] of [
      [1, 1],
      [512, 513],
      [8192, 8193],
      [262144, 262145],
      [3, 2 ** 30],
    ] as const) {
      const h = readImageHeader(headers(width, height, F16, false));
      expect([h.width, h.height]).toEqual([width, height]);
    }
  });

  it('writes image metadata the decoder reads back', () => {
    for (const [bitDepth, alpha, space, primaries] of [
      [F16, false, 'linear-rec709', 'srgb'],
      [F32, true, 'linear-p3', 'p3'],
      [U8, true, 'linear-rec2020', 'bt2100'],
    ] as const) {
      const h = readImageHeader(headers(5, 3, bitDepth, alpha, space));
      expect(h.bitDepth).toEqual({
        floatSample: bitDepth.float,
        bitsPerSample: bitDepth.bitsPerSample,
        expBits: bitDepth.expBits,
      });
      expect(h.modular16BitBuffers).toBe(bitDepth.bitsPerSample <= 12);
      expect(h.xybEncoded).toBe(false);
      expect(h.colorEncoding).toMatchObject({
        wantIcc: false,
        colorSpace: 'rgb',
        whitePoint: 'd65',
        primaries,
        transferFunction: 'linear',
        renderingIntent: 'relative',
      });
      expect(h.extraChannels).toHaveLength(alpha ? 1 : 0);
      if (alpha) {
        expect(h.extraChannels[0]).toMatchObject({ type: 'alpha', dimShift: 0, name: '', alphaAssociated: false });
        expect(h.extraChannels[0].bitDepth.bitsPerSample).toBe(bitDepth.bitsPerSample);
      }
    }
  });

  it('writes a lossless Modular frame header and TOC', () => {
    for (const alpha of [false, true]) {
      for (const shift of [0, 1, 3]) {
        const br = headers(300, 260, F16, alpha, 'linear-rec709', shift);
        const image = readImageHeader(br);
        const fh = readFrameHeader(br, image);
        expect(fh).toMatchObject({ frameType: 'regular', encoding: 'modular', groupSizeShift: shift, isLast: true });
        expect(fh.passes.numPasses).toBe(1);
        expect(fh.blendingInfo.mode).toBe('replace');
        expect(fh.ecBlendingInfo).toHaveLength(alpha ? 1 : 0);
        expect(fh.restorationFilter.gab).toBe(false);
        expect(fh.restorationFilter.epfIters).toBe(0);
      }
    }
    // TOC sizes across all four U32 buckets.
    const sizes = [0, 1023, 1024, 17407, 17408, 4211711, 4211712];
    const w = new JxlBitWriter();
    w.writeBits(8, 0xff);
    w.writeBits(8, 0x0a);
    writeSizeHeader(w, 256 * 3, 256 * 2); // 6 groups: LfGlobal + 1 LfGroup + HfGlobal + 6 = 9 entries
    writeImageMetadata(w, F16, layout(false), 'linear-rec709');
    writeFrameHeader(w, 0, 1);
    const all = [...sizes, 5, 6];
    writeToc(w, all);
    const br = new JxlBitReader(w.finish());
    const fh = readFrameHeader(br, readImageHeader(br));
    expect(readToc(br, fh).sizes).toEqual(all);
  });

  it('wraps a codestream in the container boxes', () => {
    const out = wrapJxlContainer(new Uint8Array([0xff, 0x0a, 1, 2]));
    expect(Array.from(out)).toEqual([
      0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a, 0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x6a, 0x78,
      0x6c, 0x20, 0, 0, 0, 0, 0x6a, 0x78, 0x6c, 0x20, 0, 0, 0, 12, 0x6a, 0x78, 0x6c, 0x63, 0xff, 0x0a, 1, 2,
    ]);
  });
});
