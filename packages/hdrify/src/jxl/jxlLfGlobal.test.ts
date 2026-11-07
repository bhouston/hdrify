import { describe, expect, it } from 'vitest';
import { JxlBitReader } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import {
  JXL_DEFAULT_BLOCK_CTX_MAP,
  readHfBlockContext,
  readLfChannelCorrelation,
  readQuantizer,
} from './jxlLfGlobal.js';

const read = (w: JxlBitWriter) => new JxlBitReader(w.finish());
const U4 = [{ bits: 4 }, { bits: 8, offset: 16 }, { bits: 16, offset: 272 }, { bits: 32, offset: 65808 }] as const;

/** Exact half-float bits for small dyadic values. */
function f16Bits(v: number): number {
  if (v === 0) return 0;
  const sign = v < 0 ? 0x8000 : 0;
  const a = Math.abs(v);
  const e = Math.floor(Math.log2(a));
  return sign | ((e + 15) << 10) | Math.round((a / 2 ** e - 1) * 1024);
}

describe('jxlLfGlobal bundles', () => {
  it('reads Quantizer global_scale / quant_lf (all U32 distributions)', () => {
    const w = new JxlBitWriter();
    w.writeU32(
      3000,
      { bits: 11, offset: 1 },
      { bits: 11, offset: 2049 },
      { bits: 12, offset: 4097 },
      { bits: 16, offset: 8193 },
    );
    w.writeU32(16, 16, { bits: 5, offset: 1 }, { bits: 8, offset: 1 }, { bits: 16, offset: 1 });
    w.writeU32(
      1,
      { bits: 11, offset: 1 },
      { bits: 11, offset: 2049 },
      { bits: 12, offset: 4097 },
      { bits: 16, offset: 8193 },
    );
    w.writeU32(200, 16, { bits: 5, offset: 1 }, { bits: 8, offset: 1 }, { bits: 16, offset: 1 });
    const br = read(w);
    expect(readQuantizer(br)).toEqual({ globalScale: 3000, quantLf: 16 });
    expect(readQuantizer(br)).toEqual({ globalScale: 1, quantLf: 200 });
  });

  it('uses the libjxl default block context map (15 clusters, 39 entries)', () => {
    const w = new JxlBitWriter();
    w.writeBool(true);
    const bc = readHfBlockContext(read(w));
    expect(bc.numClusters).toBe(15);
    expect(bc.numLfCtx).toBe(1);
    expect(Array.from(bc.ctxMap)).toEqual(Array.from(JXL_DEFAULT_BLOCK_CTX_MAP));
    // ac_context.h kDefaultCtxMap rows: Y, X, B (13 orders each); X and B rows are identical.
    expect(Array.from(bc.ctxMap.subarray(0, 13))).toEqual([0, 1, 2, 2, 3, 3, 4, 5, 6, 6, 6, 6, 6]);
    expect(Array.from(bc.ctxMap.subarray(13, 26))).toEqual(Array.from(bc.ctxMap.subarray(26, 39)));
  });

  it('reads custom LF / qf thresholds and a simple context map', () => {
    const w = new JxlBitWriter();
    w.writeBool(false);
    // X: 1 threshold (-3), Y: none, B: 2 thresholds (5, 300).
    w.writeBits(4, 1);
    w.writeU32(5, ...U4); // unpackSigned(5) = -3
    w.writeBits(4, 0);
    w.writeBits(4, 2);
    w.writeU32(10, ...U4);
    w.writeU32(600, ...U4);
    // qf: one threshold, coded 4 -> 5.
    w.writeBits(4, 1);
    w.writeU32(4, { bits: 2 }, { bits: 3, offset: 4 }, { bits: 5, offset: 12 }, { bits: 8, offset: 44 });
    // Context map for 39 * 6 * 2 contexts: simple, 1 bit per entry, alternating clusters.
    const n = 39 * 6 * 2;
    w.writeBits(1, 1);
    w.writeBits(2, 1);
    for (let i = 0; i < n; i++) w.writeBits(1, i & 1);
    const bc = readHfBlockContext(read(w));
    expect(Array.from(bc.lfThresholds[0])).toEqual([-3]);
    expect(Array.from(bc.lfThresholds[1])).toEqual([]);
    expect(Array.from(bc.lfThresholds[2])).toEqual([5, 300]);
    expect(Array.from(bc.qfThresholds)).toEqual([5]);
    expect(bc.numLfCtx).toBe(6);
    expect(bc.ctxMap.length).toBe(n);
    expect(bc.numClusters).toBe(2);
  });

  it('reads LfChannelCorrelation defaults and custom values', () => {
    const w = new JxlBitWriter();
    w.writeBool(true);
    w.writeBool(false);
    w.writeU32(256, 84, 256, { bits: 8, offset: 2 }, { bits: 16, offset: 258 });
    w.writeBits(16, f16Bits(-0.5));
    w.writeBits(16, f16Bits(0.75));
    w.writeBits(8, 100);
    w.writeBits(8, 140);
    const br = read(w);
    expect(readLfChannelCorrelation(br)).toEqual({
      colourFactor: 84,
      baseCorrelationX: 0,
      baseCorrelationB: 1,
      xFactorLf: 128,
      bFactorLf: 128,
    });
    expect(readLfChannelCorrelation(br)).toEqual({
      colourFactor: 256,
      baseCorrelationX: -0.5,
      baseCorrelationB: 0.75,
      xFactorLf: 100,
      bFactorLf: 140,
    });
  });
});
