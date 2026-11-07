import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JxlBitReader } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import { writeEntropyStream, type EntropyOp } from './jxlEntropyTestUtils.js';
import { JXL_DEFAULT_BLOCK_CTX_MAP, type JxlHfBlockContext, type JxlLfGlobal } from './jxlLfGlobal.js';
import { ASSETS, readPfm, readPnm } from './jxlTestAssets.js';
import {
  blockContext,
  lfContext,
  nonZeroContext,
  readCoeffOrders,
  readQuantEncoding,
  upsampleChroma2x,
  zeroDensityContext,
} from './jxlVardctDecode.js';
import { computeDequantMatrix, JXL_DEFAULT_QUANT_ENCODINGS } from './jxlVardctDequant.js';
import { defaultWpHeader } from './jxlPredictors.js';
import { naturalCoeffOrder } from './jxlVardctTransforms.js';
import { linearToSrgb } from './jxlXyb.js';
import { readJxl } from './readJxl.js';

const read = (w: JxlBitWriter) => new JxlBitReader(w.finish());
const load = (name: string) => readJxl(new Uint8Array(fs.readFileSync(new URL(name, ASSETS))));
/** Permutation context min(7, ceil(log2(x + 1))). */
const ctxOf = (x: number) => Math.min(7, 32 - Math.clz32(x));

function f16Bits(v: number): number {
  if (v === 0) return 0;
  const a = Math.abs(v);
  const e = Math.floor(Math.log2(a));
  return (v < 0 ? 0x8000 : 0) | ((e + 15) << 10) | Math.round((a / 2 ** e - 1) * 1024);
}

const defaultCtx: JxlHfBlockContext = {
  lfThresholds: [new Int32Array(0), new Int32Array(0), new Int32Array(0)],
  qfThresholds: new Int32Array(0),
  ctxMap: JXL_DEFAULT_BLOCK_CTX_MAP,
  numClusters: 15,
  numLfCtx: 1,
};

describe('VarDCT AC contexts (libjxl ac_context.h)', () => {
  it('NonZeroContext buckets predicted counts', () => {
    expect(nonZeroContext(0, 3, 15)).toBe(3);
    expect(nonZeroContext(7, 3, 15)).toBe(7 * 15 + 3);
    expect(nonZeroContext(8, 3, 15)).toBe(8 * 15 + 3);
    expect(nonZeroContext(9, 0, 15)).toBe(8 * 15);
    expect(nonZeroContext(63, 0, 1)).toBe(35);
    expect(nonZeroContext(64, 0, 1)).toBe(36);
    expect(nonZeroContext(200, 0, 1)).toBe(36);
  });

  it('ZeroDensityContext matches kCoeffNumNonzeroContext / kCoeffFreqContext', () => {
    expect(zeroDensityContext(1, 1, 0, 0)).toBe(0);
    expect(zeroDensityContext(1, 1, 0, 1)).toBe(1);
    expect(zeroDensityContext(2, 1, 0, 0)).toBe(62);
    expect(zeroDensityContext(63, 1, 0, 1)).toBe(413);
    expect(zeroDensityContext(1, 63, 0, 0)).toBe(60);
    expect(zeroDensityContext(10, 20, 0, 1)).toBe((123 + 17) * 2 + 1);
    // 4 covered blocks: nonzeros rounded up, k scaled down.
    expect(zeroDensityContext(5, 8, 2, 0)).toBe((31 + 1) * 2);
  });

  it('block context map uses Y, X, B rows (c ^ 1) and the LF/qf indices', () => {
    expect(blockContext(defaultCtx, 0, 1, 0, 1)).toBe(0); // Y, DCT8
    expect(blockContext(defaultCtx, 0, 1, 0, 0)).toBe(7); // X, DCT8
    expect(blockContext(defaultCtx, 0, 1, 4, 2)).toBe(10); // B, order 4
    expect(blockContext(defaultCtx, 0, 1, 12, 1)).toBe(6);
    const custom: JxlHfBlockContext = {
      lfThresholds: [new Int32Array([0]), new Int32Array(0), new Int32Array(0)],
      qfThresholds: new Int32Array([5]),
      ctxMap: Uint8Array.from({ length: 39 * 2 * 2 }, (_, i) => i % 16),
      numClusters: 16,
      numLfCtx: 2,
    };
    // ((Y row 0 * 13 + ord 0) * 2 + qfIdx 1) * 2 + lfIdx 1 = 3
    expect(blockContext(custom, 1, 6, 0, 1)).toBe(3);
    expect(blockContext(custom, 0, 5, 1, 0)).toBe((((13 + 1) * 2 + 0) * 2) % 16);
  });

  it('LF context bucket = ((x * (nb + 1) + b) * (ny + 1) + y) (DequantDC)', () => {
    const bc: JxlHfBlockContext = {
      ...defaultCtx,
      lfThresholds: [new Int32Array([0]), new Int32Array([-5, 5]), new Int32Array([10])],
      numLfCtx: 12,
    };
    expect(lfContext(bc, 0, 0, 0)).toBe(1);
    expect(lfContext(bc, 1, -10, 0)).toBe(6);
    expect(lfContext(bc, 1, 10, 11)).toBe(11);
  });
});

describe('VarDCT HfGlobal parsing', () => {
  const lfg: JxlLfGlobal = {
    mLf: [1 / 32, 1 / 4, 1 / 2],
    gmodular: { channels: [], nbMetaChannels: 0, transforms: [], wpHeader: defaultWpHeader(), bitDepth: 8 },
    nbColor: 0,
  };

  it('decodes DCT, identity, DCT2, DCT4, DCT4x8 and AFV parameter encodings (libjxl x64 scaling)', () => {
    const w = new JxlBitWriter();
    const f16 = (v: number) => w.writeBits(16, f16Bits(v));
    const dctParams = (bands: number[][]) => {
      w.writeBits(4, bands[0].length - 1);
      for (const b of bands) for (const v of b) f16(v);
    };
    const bands = [
      [32, -0.5, -1],
      [8, 0.25, -2],
      [4, 0, 1],
    ];
    w.writeBits(3, 6); // DCT on table 4 (16x16)
    dctParams(bands);
    w.writeBits(3, 1); // identity on table 1
    for (let c = 0; c < 9; c++) f16(c + 1);
    w.writeBits(3, 2); // DCT2 on table 2
    for (let c = 0; c < 18; c++) f16(c + 2);
    w.writeBits(3, 3); // DCT4 on table 3
    for (let c = 0; c < 6; c++) f16(1 + c / 4);
    dctParams(bands);
    w.writeBits(3, 4); // DCT4x8 on table 9
    for (let c = 0; c < 3; c++) f16(2);
    dctParams(bands);
    w.writeBits(3, 5); // AFV on table 10
    for (let c = 0; c < 27; c++) f16([2, 2, 1, 1, 1, 4, 0, 0, -0.25][c % 9]);
    dctParams(bands);
    dctParams(bands);
    w.writeBits(3, 0); // library default on table 5
    const br = read(w);
    const scaled = bands.map((b) => [b[0] * 64, ...b.slice(1)]);
    expect(readQuantEncoding(br, 4, lfg, 1)).toEqual({ mode: 'dct', dctParams: scaled });
    expect(readQuantEncoding(br, 1, lfg, 1)).toEqual({
      mode: 'identity',
      params: [
        [64, 128, 192],
        [256, 320, 384],
        [448, 512, 576],
      ],
    });
    const dct2 = readQuantEncoding(br, 2, lfg, 1);
    expect(dct2.mode === 'dct2' && dct2.params[1]).toEqual([8, 9, 10, 11, 12, 13].map((v) => v * 64));
    expect(readQuantEncoding(br, 3, lfg, 1)).toEqual({
      mode: 'dct4',
      params: [
        [1, 1.25],
        [1.5, 1.75],
        [2, 2.25],
      ],
      dctParams: scaled,
    });
    expect(readQuantEncoding(br, 9, lfg, 1)).toEqual({ mode: 'dct4x8', params: [[2], [2], [2]], dctParams: scaled });
    const afv = readQuantEncoding(br, 10, lfg, 1);
    expect(afv.mode === 'afv' && afv.params[0]).toEqual([128, 128, 64, 64, 64, 256, 0, 0, -0.25]);
    expect(readQuantEncoding(br, 5, lfg, 1)).toBe(JXL_DEFAULT_QUANT_ENCODINGS[5]);
    // The decoded DCT encoding yields valid matrices whose DC multiplier is 1 / band0.
    expect(computeDequantMatrix(4, { mode: 'dct', dctParams: scaled })[0][0]).toBeCloseTo(1 / 2048, 9);
  });

  it('rejects 8x8-only modes on larger tables', () => {
    const w = new JxlBitWriter();
    w.writeBits(3, 1);
    expect(() => readQuantEncoding(read(w), 4, lfg, 1)).toThrow(/quant table mode/);
  });

  it('applies coefficient-order permutations to the natural order (LLF skipped)', () => {
    // Order 0 (DCT8), channel X: swap natural positions 1 and 2, i.e. Lehmer [_, 1, 0]; Y and B: identity.
    const ops: EntropyOp[] = [
      { ctx: ctxOf(64), value: 2 },
      { ctx: ctxOf(0), value: 1 },
      { ctx: ctxOf(1), value: 0 },
      { ctx: ctxOf(64), value: 0 },
      { ctx: ctxOf(64), value: 0 },
    ];
    const w = new JxlBitWriter();
    writeEntropyStream(w, { numDists: 8, usePrefix: true }, ops);
    const orders = readCoeffOrders(read(w), 1);
    const nat = naturalCoeffOrder(0);
    const x = orders[0][0];
    expect([x[2], x[3]]).toEqual([nat[4], nat[5]]);
    expect([x[4], x[5]]).toEqual([nat[2], nat[3]]);
    expect(Array.from(x.subarray(6))).toEqual(Array.from(nat.subarray(6)));
    expect(orders[0][1]).toEqual(nat);
    expect(orders[3][2]).toBe(naturalCoeffOrder(3));
  });
});

describe('readJxl lossy corpus vs djxl (sRGB-encoded refs unless linear)', () => {
  for (const [name, linear] of [
    ['vardct_nofilters', false],
    ['vardct_rgb8', false],
    ['vardct_float', true],
    ['vardct_odd_multigroup', false],
    ['vardct_progressive', false],
    ['vardct_resampling', false],
    ['vardct_noise', false],
    ['vardct_jpeg444', false],
    ['vardct_jpeg420', false],
    ['vardct_grad128', false],
    ['vardct_d01', false],
    ['lossy_modular', false],
    ['lossy_modular_gray', false], // gray XYB Modular codes 3 colour channels
  ] as const) {
    it(`${name} matches djxl`, () => {
      const img = load(`${name}.jxl`);
      const ref = readPfm(`${name}.ref.pfm`);
      expect([img.width, img.height]).toEqual([ref.width, ref.height]);
      let max = 0;
      let sum = 0;
      for (let i = 0; i < img.width * img.height; i++) {
        for (let c = 0; c < 3; c++) {
          const v = img.data[i * 4 + c];
          const r = ref.samples[i * ref.channels + (ref.channels === 1 ? 0 : c)];
          // Linear HDR: relative error; otherwise compare in sRGB space.
          const e = linear ? Math.abs(v - r) / Math.max(1, Math.abs(r)) : Math.abs(linearToSrgb(v) - r);
          max = Math.max(max, e);
          sum += e;
        }
        expect(img.data[i * 4 + 3]).toBe(1);
      }
      expect(max).toBeLessThan(0.05 / 255);
      expect(sum / (img.width * img.height * 3)).toBeLessThan(0.002 / 255);
    });
  }

  it('vardct_rgba8 matches the 8-bit djxl PAM (colour and alpha)', () => {
    const img = load('vardct_rgba8.jxl');
    const ref = readPnm('vardct_rgba8.ref.pam');
    let max = 0;
    for (let i = 0; i < img.width * img.height; i++) {
      for (let c = 0; c < 4; c++) {
        const v = c < 3 ? linearToSrgb(img.data[i * 4 + c]) : img.data[i * 4 + c];
        max = Math.max(max, Math.abs(Math.round(Math.min(1, Math.max(0, v)) * 255) - ref.samples[i * 4 + c]));
      }
    }
    expect(max).toBeLessThanOrEqual(1);
  });

  it('decodes 4:2:0 / 4:2:2 chroma subsampling with (3/4, 1/4) chroma upsampling', () => {
    const p = Float32Array.from([0, 4, 8]);
    expect(Array.from(upsampleChroma2x(p, 3, 1, true))).toEqual([0, 1, 3, 5, 7, 8]);
    expect(Array.from(upsampleChroma2x(p, 1, 3, false))).toEqual([0, 1, 3, 5, 7, 8]);
  });

  it('reports VarDCT encoding and linear sRGB primaries for XYB images', () => {
    const img = load('vardct_rgb8.jxl');
    expect(img.metadata?.encoding).toBe('vardct');
    expect(img.linearColorSpace).toBe('linear-rec709');
  });
});
