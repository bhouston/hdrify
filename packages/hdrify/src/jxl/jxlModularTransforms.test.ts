import { describe, expect, it } from 'vitest';
import { JxlBitReader } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import type { ModularChannel, ModularImage } from './jxlModular.js';
import {
  applyInverseTransforms,
  defaultSqueezeParams,
  getPaletteValue,
  inverseRct,
  metaApplyTransform,
  readTransform,
  smoothTendency,
  type SqueezeParams,
  type TransformInfo,
} from './jxlModularTransforms.js';
import { defaultWpHeader, Predictor } from './jxlPredictors.js';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chan(width: number, height: number, fill?: (i: number) => number, hshift = 0, vshift = 0): ModularChannel {
  return { width, height, hshift, vshift, data: Int32Array.from({ length: width * height }, (_, i) => fill?.(i) ?? 0) };
}

function image(
  channels: ModularChannel[],
  transforms: TransformInfo[] = [],
  nbMetaChannels = 0,
  bitDepth = 8,
): ModularImage {
  return { channels, nbMetaChannels, transforms, wpHeader: defaultWpHeader(), bitDepth };
}

const sizes = (img: ModularImage) => img.channels.map((c) => [c.width, c.height, c.hshift, c.vshift]);

// ---------------------------------------------------------------------------------------------

/** Forward RCT (libjxl enc_rct.cc FwdRCT): permute inputs, then decorrelate. */
function forwardRct(ch: ModularChannel[], begin: number, rctType: number): void {
  const perm = Math.floor(rctType / 7);
  const custom = rctType % 7;
  const src = [ch[begin].data, ch[begin + 1].data, ch[begin + 2].data];
  const in0 = src[perm % 3];
  const in1 = src[(perm + 1 + Math.floor(perm / 3)) % 3];
  const in2 = src[(perm + 2 - Math.floor(perm / 3)) % 3];
  const n = in0.length;
  const o = [new Int32Array(n), new Int32Array(n), new Int32Array(n)] as const;
  for (let i = 0; i < n; i++) {
    const first = in0[i];
    let second = in1[i];
    let third = in2[i];
    if (custom === 6) {
      const o1 = first - third;
      const tmp = third + (o1 >> 1);
      const o2 = second - tmp;
      o[0][i] = tmp + (o2 >> 1);
      o[1][i] = o1;
      o[2][i] = o2;
      continue;
    }
    if (custom >> 1 === 1) second -= first;
    else if (custom >> 1 === 2) second -= (first + third) >> 1;
    if (custom & 1) third -= first;
    o[0][i] = first;
    o[1][i] = second;
    o[2][i] = third;
  }
  for (let k = 0; k < 3; k++) ch[begin + k].data = o[k]!;
}

describe('RCT', () => {
  for (let rctType = 0; rctType < 42; rctType++) {
    it(`round-trips rct_type ${rctType}`, () => {
      const r = rng(rctType + 1);
      const orig = [0, 1, 2, 3].map(() => chan(5, 3, () => Math.floor(r() * 65536) - 32768));
      const ch = orig.map((c) => ({ ...c, data: c.data.slice() }));
      forwardRct(ch, 1, rctType);
      inverseRct(ch, 1, rctType);
      expect(ch.map((c) => Array.from(c.data))).toEqual(orig.map((c) => Array.from(c.data)));
    });
  }

  it('YCoCg inverse matches hand-computed values', () => {
    // Y=100, Co=20, Cg=-10: tmp = 100 - (-5) = 105; G = 95; B = 105 - 10 = 95; R = 115
    const ch = [chan(1, 1, () => 100), chan(1, 1, () => 20), chan(1, 1, () => -10)];
    inverseRct(ch, 0, 6);
    expect(ch.map((c) => c.data[0])).toEqual([115, 95, 95]);
  });

  it('permutation-only types reorder channels', () => {
    // rct_type 7: permutation 1 (out0 -> ch1, out1 -> ch2, out2 -> ch0)
    const ch = [chan(1, 1, () => 1), chan(1, 1, () => 2), chan(1, 1, () => 3)];
    inverseRct(ch, 0, 7);
    expect(ch.map((c) => c.data[0])).toEqual([3, 1, 2]);
  });

  it('wraps modulo 2^32 like libjxl PixelAdd', () => {
    const ch = [chan(1, 1, () => 2 ** 31 - 1), chan(1, 1, () => 1), chan(1, 1, () => 1)];
    inverseRct(ch, 0, 3); // second += first, third += first
    expect(ch.map((c) => c.data[0])).toEqual([2 ** 31 - 1, -(2 ** 31), -(2 ** 31)]);
  });
});

// ---------------------------------------------------------------------------------------------

const AVERAGE = (x: number, y: number) => (x + y + (x > y ? 1 : 0)) >> 1;

/** Forward horizontal squeeze (libjxl enc_squeeze.cc FwdHSqueeze); returns [avg, residual]. */
function fwdH(c: ModularChannel): [ModularChannel, ModularChannel] {
  const ow = (c.width + 1) >> 1;
  const rw = c.width - ow;
  const hs = c.hshift >= 0 ? c.hshift + 1 : c.hshift;
  const out = chan(ow, c.height, undefined, hs, c.vshift);
  const res = chan(rw, c.height, undefined, hs, c.vshift);
  for (let y = 0; y < c.height; y++) {
    const p = (x: number) => c.data[y * c.width + x];
    for (let x = 0; x < rw; x++) {
      const avg = AVERAGE(p(2 * x), p(2 * x + 1));
      out.data[y * ow + x] = avg;
      let next = avg;
      if (x + 1 < rw) next = AVERAGE(p(2 * x + 2), p(2 * x + 3));
      else if (c.width & 1) next = p(2 * x + 2);
      const left = x > 0 ? p(2 * x - 1) : avg;
      res.data[y * rw + x] = p(2 * x) - p(2 * x + 1) - smoothTendency(left, avg, next);
    }
    if (c.width & 1) out.data[y * ow + ow - 1] = p(c.width - 1);
  }
  return [out, res];
}

function transpose(c: ModularChannel): ModularChannel {
  const t = chan(c.height, c.width, undefined, c.vshift, c.hshift);
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) t.data[x * c.height + y] = c.data[y * c.width + x]!;
  return t;
}

/** Forward vertical squeeze = horizontal squeeze of the transpose (same arithmetic as FwdVSqueeze). */
function fwdV(c: ModularChannel): [ModularChannel, ModularChannel] {
  const [a, r] = fwdH(transpose(c));
  return [transpose(a), transpose(r)];
}

/** libjxl FwdSqueeze. */
function forwardSqueeze(ch: ModularChannel[], params: SqueezeParams[]): void {
  for (const p of params) {
    const end = p.beginC + p.numC - 1;
    const offset = p.inPlace ? end + 1 : ch.length;
    for (let c = p.beginC; c <= end; c++) {
      const [a, r] = p.horizontal ? fwdH(ch[c]) : fwdV(ch[c]);
      ch[c] = a;
      ch.splice(offset + c - p.beginC, 0, r);
    }
  }
}

describe('Squeeze', () => {
  it('smooth tendency (libjxl SmoothTendency)', () => {
    expect(smoothTendency(10, 5, 0)).toBe(Math.trunc((40 - 0 - 5 + 6) / 12));
    expect(smoothTendency(0, 5, 10)).toBe(Math.trunc((0 - 30 - 5 - 6) / 12));
    expect(smoothTendency(0, 5, 0)).toBe(0); // non-monotonic
    expect(smoothTendency(100, 1, 0)).toBe(2); // clamped by 2 * (a - n)
  });

  it('default parameters (libjxl DefaultSqueezeParameters)', () => {
    const ch = [chan(20, 10), chan(20, 10), chan(20, 10)];
    expect(defaultSqueezeParams(ch, 0)).toEqual([
      { horizontal: true, inPlace: false, beginC: 1, numC: 2 },
      { horizontal: false, inPlace: false, beginC: 1, numC: 2 },
      { inPlace: true, beginC: 0, numC: 3, horizontal: true },
      { inPlace: true, beginC: 0, numC: 3, horizontal: false },
      { inPlace: true, beginC: 0, numC: 3, horizontal: true },
    ]);
    // Tall single channel: vertical first.
    expect(defaultSqueezeParams([chan(4, 20)], 0).map((p) => p.horizontal)).toEqual([false, false]);
  });

  for (const [w, h, n] of [
    [1, 1, 1],
    [2, 1, 1],
    [1, 2, 1],
    [7, 5, 3],
    [20, 10, 3],
    [33, 17, 1],
    [16, 16, 4],
  ] as const) {
    it(`round-trips default squeeze ${w}x${h}x${n}`, () => {
      const r = rng(w * 100 + h);
      const orig = Array.from({ length: n }, () => chan(w, h, () => Math.floor(r() * 1024) - 512));
      const img = image(orig.map((c) => ({ ...c, data: c.data.slice() })));
      const t: TransformInfo = { kind: 'squeeze', params: [] };
      // Bookkeeping must predict the forward channel list.
      const desc = image(orig.map((c) => ({ ...c, data: new Int32Array(0) })));
      metaApplyTransform(desc, t);
      forwardSqueeze(img.channels, t.params);
      expect(sizes(desc)).toEqual(sizes(img));
      img.transforms = [t];
      applyInverseTransforms(img);
      expect(sizes(img)).toEqual(sizes(image(orig)));
      expect(img.channels.map((c) => Array.from(c.data))).toEqual(orig.map((c) => Array.from(c.data)));
    });
  }

  it('round-trips explicit params mixing in-place and appended residuals', () => {
    const r = rng(42);
    const orig = [chan(9, 6, () => Math.floor(r() * 300)), chan(9, 6, () => Math.floor(r() * 300))];
    const params: SqueezeParams[] = [
      { horizontal: false, inPlace: false, beginC: 0, numC: 2 },
      { horizontal: true, inPlace: true, beginC: 1, numC: 1 },
    ];
    const img = image(orig.map((c) => ({ ...c, data: c.data.slice() })));
    forwardSqueeze(img.channels, params);
    img.transforms = [{ kind: 'squeeze', params }];
    applyInverseTransforms(img);
    expect(img.channels.map((c) => Array.from(c.data))).toEqual(orig.map((c) => Array.from(c.data)));
  });

  it('rejects squeezing an empty channel', () => {
    expect(() => metaApplyTransform(image([chan(0, 20)]), { kind: 'squeeze', params: [] })).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------

describe('Palette', () => {
  const pal = Int32Array.from([10, 20, 30, 40, 50, 60]); // 2 colours x 3 channels (row per channel)

  it('explicit, implicit-cube and delta entries (libjxl GetPaletteValue)', () => {
    expect([0, 1, 2].map((c) => getPaletteValue(pal, 1, c, 2, 8))).toEqual([20, 40, 60]);
    // Small cube: index 2 + 1 -> components (1, 0, 0) of 4 levels, + 1 << (8 - 3).
    expect([0, 1, 2, 3].map((c) => getPaletteValue(pal, 3, c, 2, 8))).toEqual([63 + 32, 32, 32, 0]);
    // Large cube: index 2 + 64 + 7 -> components (2, 1, 0) of 5 levels: (v * 255) >> 2.
    expect([0, 1, 2, 3].map((c) => getPaletteValue(pal, 2 + 64 + 7, c, 2, 8))).toEqual([127, 63, 0, 0]);
    // Deltas: -1 -> kDeltaPalette[0] = 0; -2 -> +[4,4,4]; -3 -> -[4,4,4]; -4 -> +[11,0,0].
    expect([0, 1, 2].map((c) => getPaletteValue(pal, -2, c, 2, 8))).toEqual([4, 4, 4]);
    expect([0, 1, 2].map((c) => getPaletteValue(pal, -3, c, 2, 8))).toEqual([-4, -4, -4]);
    expect([0, 1, 2, 3].map((c) => getPaletteValue(pal, -4, c, 2, 8))).toEqual([11, 0, 0, 0]);
    expect(getPaletteValue(pal, -2, 0, 2, 10)).toBe(16); // scaled by 2^(bitdepth - 8)
    expect(getPaletteValue(pal, -1 - 143 - 1, 0, 2, 8)).toBe(4); // wraps modulo 143
  });

  it('bookkeeping on colour channels and inverse with implicit colours', () => {
    const img = image([chan(3, 1, (i) => [0, 1, 3][i]), chan(3, 1), chan(3, 1), chan(3, 1, () => 7)]);
    const t: TransformInfo = { kind: 'palette', beginC: 0, numC: 3, nbColours: 2, nbDeltas: 0, dPred: 0 };
    const desc = image([chan(3, 1), chan(3, 1), chan(3, 1), chan(3, 1)]);
    metaApplyTransform(desc, t);
    expect(sizes(desc)).toEqual([
      [2, 3, -1, -1],
      [3, 1, 0, 0],
      [3, 1, 0, 0],
    ]);
    expect(desc.nbMetaChannels).toBe(1);
    // Build the coded image: palette meta channel + index channel + untouched channel.
    const coded = image(
      [{ ...chan(2, 3), hshift: -1, vshift: -1, data: pal.slice() }, img.channels[0], img.channels[3]],
      [t],
      1,
    );
    applyInverseTransforms(coded);
    expect(coded.nbMetaChannels).toBe(0);
    expect(coded.channels.map((c) => Array.from(c.data))).toEqual([
      [10, 20, 95],
      [30, 40, 32],
      [50, 60, 32],
      [7, 7, 7],
    ]);
  });

  it('single-channel palette clamps out-of-range indices (libjxl fast path)', () => {
    const coded = image(
      [{ ...chan(2, 1), hshift: -1, vshift: -1, data: Int32Array.from([5, 9]) }, chan(4, 1, (i) => [0, 1, 7, -3][i])],
      [{ kind: 'palette', beginC: 0, numC: 1, nbColours: 2, nbDeltas: 0, dPred: 0 }],
      1,
    );
    applyInverseTransforms(coded);
    expect(Array.from(coded.channels[0].data)).toEqual([5, 9, 9, 5]);
  });

  it('delta entries add the d_pred prediction', () => {
    // Palette (deltas first): entry 0 = delta 10, entry 1 = 20, entry 2 = 30; predictor Left.
    const coded = image(
      [
        { ...chan(3, 1), hshift: -1, vshift: -1, data: Int32Array.from([10, 20, 30]) },
        chan(4, 1, (i) => [1, 0, 0, 2][i]),
      ],
      [{ kind: 'palette', beginC: 0, numC: 1, nbColours: 2, nbDeltas: 1, dPred: Predictor.Left }],
      1,
    );
    applyInverseTransforms(coded);
    expect(Array.from(coded.channels[0].data)).toEqual([20, 30, 40, 30]);
  });

  it('delta palette with the weighted predictor runs WP over every sample', () => {
    const coded = image(
      [{ ...chan(1, 1), hshift: -1, vshift: -1, data: Int32Array.from([0]) }, chan(3, 2, () => 0)],
      [{ kind: 'palette', beginC: 0, numC: 1, nbColours: 0, nbDeltas: 1, dPred: Predictor.Weighted }],
      1,
    );
    applyInverseTransforms(coded);
    // All-zero deltas over a zero image: WP predicts 0 everywhere.
    expect(Array.from(coded.channels[0].data)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('palette over meta channels adjusts nb_meta_channels by 2 - num_c', () => {
    const img = image([chan(4, 1), chan(4, 1), chan(8, 8)], [], 2);
    metaApplyTransform(img, { kind: 'palette', beginC: 0, numC: 2, nbColours: 3, nbDeltas: 0, dPred: 0 });
    expect(img.nbMetaChannels).toBe(2);
    expect(sizes(img)).toEqual([
      [3, 2, -1, -1],
      [4, 1, 0, 0],
      [8, 8, 0, 0],
    ]);
  });

  it('rejects channel ranges mixing meta and non-meta channels', () => {
    const img = image([chan(4, 1), chan(4, 1)], [], 1);
    expect(() =>
      metaApplyTransform(img, { kind: 'palette', beginC: 0, numC: 2, nbColours: 3, nbDeltas: 0, dPred: 0 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------

describe('readTransform', () => {
  it('parses RCT, Palette and Squeeze bundles', () => {
    const w = new JxlBitWriter();
    // RCT: id 0, begin_c = 2 (Bits(3)), rct_type selector 0 -> 6
    w.writeBits(2, 0);
    w.writeBits(2, 0);
    w.writeBits(3, 2);
    w.writeBits(2, 0);
    // Palette: id 1, begin_c 0, num_c selector 1 (3), nb_colours sel 0 Bits(8)=17, nb_deltas sel 1 (1 + 5), d_pred 5
    w.writeBits(2, 1);
    w.writeBits(2, 0);
    w.writeBits(3, 0);
    w.writeBits(2, 1);
    w.writeBits(2, 0);
    w.writeBits(8, 17);
    w.writeBits(2, 1);
    w.writeBits(8, 5);
    w.writeBits(4, 5);
    // Squeeze: id 2, num_sq selector 1 -> 1 + Bits(4)=0 -> 1; horizontal, !in_place, begin_c 1, num_c sel 2 (3)
    w.writeBits(2, 2);
    w.writeBits(2, 1);
    w.writeBits(4, 0);
    w.writeBool(true);
    w.writeBool(false);
    w.writeBits(2, 0);
    w.writeBits(3, 1);
    w.writeBits(2, 2);
    const br = new JxlBitReader(w.finish());
    expect(readTransform(br)).toEqual({ kind: 'rct', beginC: 2, rctType: 6 });
    expect(readTransform(br)).toEqual({ kind: 'palette', beginC: 0, numC: 3, nbColours: 17, nbDeltas: 6, dPred: 5 });
    expect(readTransform(br)).toEqual({
      kind: 'squeeze',
      params: [{ horizontal: true, inPlace: false, beginC: 1, numC: 3 }],
    });
  });
});
