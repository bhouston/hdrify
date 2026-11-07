import { describe, expect, it } from 'vitest';
import {
  AFV_BASIS,
  dctResampleScale,
  forwardDct2d,
  inverseDct2d,
  JXL_AC_STRATEGIES,
  JXL_ORDER_BLOCK_SIZES,
  JxlAcStrategy,
  lowestFrequenciesFromLf,
  naturalCoeffOrder,
  transformToPixels,
} from './jxlVardctTransforms.js';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

/** Naive float64 scaled DCT-II (libjxl convention: X0 = mean, Xk = sqrt2/N sum ...). */
function naiveForward(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += x[i] * Math.cos((Math.PI * k * (2 * i + 1)) / (2 * n));
    out[k] = (k === 0 ? s : s * Math.SQRT2) / n;
  }
  return out;
}

/** Naive float64 scaled DCT-III. */
function naiveInverse(c: ArrayLike<number>): Float64Array {
  const n = c.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = c[0];
    for (let k = 1; k < n; k++) s += Math.SQRT2 * c[k] * Math.cos((Math.PI * k * (2 * i + 1)) / (2 * n));
    out[i] = s;
  }
  return out;
}

/** Naive separable 2D inverse on a row-major w x h block. */
function naiveInverse2d(c: ArrayLike<number>, w: number, h: number): Float64Array {
  const tmp = new Float64Array(w * h);
  for (let y = 0; y < h; y++) tmp.set(naiveInverse(Array.from({ length: w }, (_, x) => c[y * w + x])), y * w);
  const out = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    const col = naiveInverse(Array.from({ length: h }, (_, y) => tmp[y * w + x]));
    for (let y = 0; y < h; y++) out[y * w + x] = col[y];
  }
  return out;
}

function maxErr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

// The non-DCT 8x8 transforms share coefficient order 1.
const DCT_STRATEGIES = JXL_AC_STRATEGIES.map((_, i) => i).filter((i) => JXL_AC_STRATEGIES[i].orderId !== 1);
const SPECIAL_STRATEGIES = JXL_AC_STRATEGIES.map((_, i) => i).filter((i) => JXL_AC_STRATEGIES[i].orderId === 1);

describe('jxlVardctTransforms: 1D DCT vs naive reference', () => {
  for (const n of [2, 4, 8, 16, 32, 64, 128, 256]) {
    it(`forward/inverse n=${n}`, () => {
      const r = rng(n);
      const x = Float32Array.from({ length: n }, r);
      const f = x.slice();
      forwardDct2d(f, n, 1);
      expect(maxErr(f, naiveForward(x))).toBeLessThan(2e-6);
      const inv = x.slice();
      inverseDct2d(inv, n, 1);
      expect(maxErr(inv, naiveInverse(x))).toBeLessThan(2e-5 * Math.sqrt(n));
      inverseDct2d(f, n, 1);
      expect(maxErr(f, x)).toBeLessThan(2e-6 * Math.sqrt(n));
    });
  }
});

describe('jxlVardctTransforms: strategy table', () => {
  it('has 27 strategies with libjxl block sizes and quant table / order ids', () => {
    expect(JXL_AC_STRATEGIES).toHaveLength(27);
    const s = JXL_AC_STRATEGIES[JxlAcStrategy.DCT16X8];
    expect([s.blocksX, s.blocksY, s.quantTable, s.orderId, s.transposed]).toEqual([1, 2, 6, 4, true]);
    const t = JXL_AC_STRATEGIES[JxlAcStrategy.DCT8X16];
    expect([t.blocksX, t.blocksY, t.transposed]).toEqual([2, 1, false]);
    const big = JXL_AC_STRATEGIES[JxlAcStrategy.DCT128X256];
    expect([big.blocksX, big.blocksY, big.quantTable, big.orderId]).toEqual([32, 16, 16, 12]);
    expect(SPECIAL_STRATEGIES).toEqual([1, 2, 3, 12, 13, 14, 15, 16, 17]);
    for (const i of SPECIAL_STRATEGIES) expect(JXL_AC_STRATEGIES[i].transposed).toBe(false);
  });
});

describe('jxlVardctTransforms: natural coefficient order', () => {
  it('is a permutation starting with the LLF block then the zig-zag', () => {
    for (let id = 0; id < 13; id++) {
      const [w, h] = JXL_ORDER_BLOCK_SIZES[id];
      const ord = naturalCoeffOrder(id);
      const seen = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const x = ord[i * 2];
        const y = ord[i * 2 + 1];
        expect(x < w && y < h).toBe(true);
        seen[y * w + x] = 1;
        if (i < (w / 8) * (h / 8)) expect(x < w / 8 && y < h / 8).toBe(true);
      }
      expect(seen.every((v) => v === 1)).toBe(true);
    }
    expect(Array.from(naturalCoeffOrder(0).subarray(0, 12))).toEqual([0, 0, 1, 0, 0, 1, 0, 2, 1, 1, 2, 0]);
  });

  it('transposes only tall / square DCTs', () => {
    expect(JXL_AC_STRATEGIES[JxlAcStrategy.DCT8X16].transposed).toBe(false); // 16 wide, 8 tall
    expect(JXL_AC_STRATEGIES[JxlAcStrategy.DCT16X8].transposed).toBe(true); // 8 wide, 16 tall
    // DCT8 is transposed, IDENTITY (same order) is not.
    expect(JXL_AC_STRATEGIES[JxlAcStrategy.DCT8].transposed).toBe(true);
    expect(JXL_AC_STRATEGIES[JxlAcStrategy.IDENTITY].transposed).toBe(false);
  });
});

describe('jxlVardctTransforms: DCT strategies', () => {
  for (const s of DCT_STRATEGIES) {
    const { name, blocksX, blocksY } = JXL_AC_STRATEGIES[s];
    const w = blocksX * 8;
    const h = blocksY * 8;
    it(`${name}: inverse matches naive 2D IDCT and forward∘inverse ≈ id`, () => {
      const r = rng(s + 7);
      const coeffs = Float32Array.from({ length: w * h }, r);
      const px = coeffs.slice();
      transformToPixels(s, px);
      if (w * h <= 64 * 64) expect(maxErr(px, naiveInverse2d(coeffs, w, h))).toBeLessThan(1e-3);
      forwardDct2d(px, w, h);
      expect(maxErr(px, coeffs)).toBeLessThan(1e-4);
    });
  }

  it('supports an embedded block with stride', () => {
    const stride = 40;
    const buf = new Float32Array(stride * 20).fill(7);
    const r = rng(3);
    const coeffs = Float32Array.from({ length: 128 }, r);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) buf[(y + 2) * stride + 5 + x] = coeffs[y * 16 + x];
    transformToPixels(JxlAcStrategy.DCT8X16, buf, 2 * stride + 5, stride);
    const ref = naiveInverse2d(coeffs, 16, 8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 16; x++) expect(buf[(y + 2) * stride + 5 + x]).toBeCloseTo(ref[y * 16 + x], 4);
    }
    expect(buf[0]).toBe(7);
    expect(buf[2 * stride + 4]).toBe(7);
  });
});

// --- Literal transcription of libjxl dec_transforms-inl.h for the 8x8 special
// transforms, with ComputeScaledIDCT<ROWS, COLS> implemented naively using
// libjxl's storage convention (ROWS < COLS: [r * COLS + c] = (vertical r,
// horizontal c); otherwise transposed [a * ROWS + b] = (horizontal a, vertical b)).

function libjxlScaledIdct(rows: number, cols: number, from: ArrayLike<number>): Float64Array {
  const c = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) c[r * cols + k] = rows < cols ? from[r * cols + k] : from[k * rows + r];
  }
  return naiveInverse2d(c, cols, rows);
}

function libjxlSpecial(strategy: number, co: Float32Array): Float64Array {
  const px = new Float64Array(64);
  const put = (src: Float64Array, w: number, h: number, ox: number, oy: number) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[(oy + y) * 8 + ox + x] = src[y * w + x];
  };
  const dcs4 = () => {
    const [b00, b01, b10, b11] = [co[0], co[1], co[8], co[9]];
    return [b00 + b01 + b10 + b11, b00 + b01 - b10 - b11, b00 - b01 + b10 - b11, b00 - b01 - b10 + b11];
  };
  switch (strategy) {
    case JxlAcStrategy.IDENTITY: {
      const dcs = dcs4();
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 2; x++) {
          let residual = 0;
          for (let iy = 0; iy < 4; iy++)
            for (let ix = 0; ix < 4; ix++) if (ix || iy) residual += co[(y + iy * 2) * 8 + x + ix * 2];
          const c11 = dcs[y * 2 + x] - residual / 16;
          px[(4 * y + 1) * 8 + 4 * x + 1] = c11;
          for (let iy = 0; iy < 4; iy++) {
            for (let ix = 0; ix < 4; ix++) {
              if (ix === 1 && iy === 1) continue;
              px[(y * 4 + iy) * 8 + x * 4 + ix] = co[(y + iy * 2) * 8 + x + ix * 2] + c11;
            }
          }
          px[y * 4 * 8 + x * 4] = co[(y + 2) * 8 + x + 2] + c11;
        }
      }
      break;
    }
    case JxlAcStrategy.DCT8X4:
    case JxlAcStrategy.DCT4X8: {
      const dcs = [co[0] + co[8], co[0] - co[8]];
      for (let i = 0; i < 2; i++) {
        const block = new Float64Array(32);
        block[0] = dcs[i];
        for (let iy = 0; iy < 4; iy++)
          for (let ix = 0; ix < 8; ix++) if (ix || iy) block[iy * 8 + ix] = co[(i + iy * 2) * 8 + ix];
        if (strategy === JxlAcStrategy.DCT8X4) put(libjxlScaledIdct(8, 4, block), 4, 8, i * 4, 0);
        else put(libjxlScaledIdct(4, 8, block), 8, 4, 0, i * 4);
      }
      break;
    }
    case JxlAcStrategy.DCT4X4: {
      const dcs = dcs4();
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 2; x++) {
          const block = new Float64Array(16);
          block[0] = dcs[y * 2 + x];
          for (let iy = 0; iy < 4; iy++)
            for (let ix = 0; ix < 4; ix++) if (ix || iy) block[iy * 4 + ix] = co[(y + iy * 2) * 8 + x + ix * 2];
          put(libjxlScaledIdct(4, 4, block), 4, 4, x * 4, y * 4);
        }
      }
      break;
    }
    case JxlAcStrategy.DCT2X2: {
      const c = Float64Array.from(co);
      for (const s of [2, 4, 8]) {
        const n = s / 2;
        const t = c.slice();
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            const c00 = c[y * 8 + x],
              c01 = c[y * 8 + n + x],
              c10 = c[(y + n) * 8 + x],
              c11 = c[(y + n) * 8 + n + x];
            t[y * 16 + x * 2] = c00 + c01 + c10 + c11;
            t[y * 16 + x * 2 + 1] = c00 + c01 - c10 - c11;
            t[(y * 2 + 1) * 8 + x * 2] = c00 - c01 + c10 - c11;
            t[(y * 2 + 1) * 8 + x * 2 + 1] = c00 - c01 - c10 + c11;
          }
        }
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) c[y * 8 + x] = t[y * 8 + x];
      }
      px.set(c);
      break;
    }
    default: {
      const kind = strategy - JxlAcStrategy.AFV0;
      const ax = kind & 1;
      const ay = kind >> 1;
      const [b00, b01, b10] = [co[0], co[1], co[8]];
      const coeff = new Float64Array(16);
      coeff[0] = (b00 + b10 + b01) * 4;
      for (let iy = 0; iy < 4; iy++)
        for (let ix = 0; ix < 4; ix++) if (ix || iy) coeff[iy * 4 + ix] = co[iy * 16 + ix * 2];
      const afv = new Float64Array(16);
      for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) afv[i] = afv[i] + coeff[j] * AFV_BASIS[j][i];
      for (let iy = 0; iy < 4; iy++) {
        for (let ix = 0; ix < 4; ix++)
          px[(iy + ay * 4) * 8 + ax * 4 + ix] = afv[(ay ? 3 - iy : iy) * 4 + (ax ? 3 - ix : ix)];
      }
      const b4 = new Float64Array(16);
      b4[0] = b00 + b10 - b01;
      for (let iy = 0; iy < 4; iy++)
        for (let ix = 0; ix < 4; ix++) if (ix || iy) b4[iy * 4 + ix] = co[iy * 16 + ix * 2 + 1];
      put(libjxlScaledIdct(4, 4, b4), 4, 4, ax ? 0 : 4, ay * 4);
      const b8 = new Float64Array(32);
      b8[0] = b00 - b10;
      for (let iy = 0; iy < 4; iy++)
        for (let ix = 0; ix < 8; ix++) if (ix || iy) b8[iy * 8 + ix] = co[(1 + iy * 2) * 8 + ix];
      put(libjxlScaledIdct(4, 8, b8), 8, 4, 0, ay ? 0 : 4);
    }
  }
  return px;
}

describe('jxlVardctTransforms: special 8x8 transforms vs libjxl transcription', () => {
  for (const s of SPECIAL_STRATEGIES) {
    it(JXL_AC_STRATEGIES[s].name, () => {
      for (let trial = 0; trial < 4; trial++) {
        const co = Float32Array.from({ length: 64 }, rng(s * 31 + trial));
        const px = co.slice();
        transformToPixels(s, px);
        expect(maxErr(px, libjxlSpecial(s, co))).toBeLessThan(1e-5);
      }
    });
    it(`${JXL_AC_STRATEGIES[s].name}: DC-only block is flat`, () => {
      const co = new Float32Array(64);
      co[0] = 0.75;
      transformToPixels(s, co);
      for (const v of co) expect(v).toBeCloseTo(0.75, 5);
    });
  }

  it('AFV basis is orthonormal (libjxl k4x4AFVBasis)', () => {
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 16; j++) {
        let d = 0;
        for (let k = 0; k < 16; k++) d += AFV_BASIS[i][k] * AFV_BASIS[j][k];
        expect(d).toBeCloseTo(i === j ? 1 : 0, 5);
      }
    }
  });
});

describe('jxlVardctTransforms: LLF from LF', () => {
  it('resample scales match libjxl dct_scales.h', () => {
    expect(dctResampleScale(1, 2)).toBeCloseTo(1 / 1.1089373535927318, 7);
    expect(dctResampleScale(3, 4)).toBeCloseTo(0.7870549181591013, 7);
    expect(1 / dctResampleScale(7, 8)).toBeCloseTo(1.3944898413647777, 6);
  });

  it('copies LF for 1x1 strategies and keeps a constant LF flat for large ones', () => {
    const lf = new Float32Array(32 * 32).fill(0.3);
    const b8 = new Float32Array(64);
    lowestFrequenciesFromLf(JxlAcStrategy.AFV2, lf, 0, 32, b8, 0, 8);
    expect(b8[0]).toBeCloseTo(0.3, 6);
    for (const s of [JxlAcStrategy.DCT16X8, JxlAcStrategy.DCT32X64, JxlAcStrategy.DCT256X256]) {
      const { blocksX, blocksY } = JXL_AC_STRATEGIES[s];
      const w = blocksX * 8;
      const block = new Float32Array(w * blocksY * 8);
      lowestFrequenciesFromLf(s, lf, 0, 32, block, 0, w);
      transformToPixels(s, block);
      expect(maxErr(block, new Float32Array(block.length).fill(0.3))).toBeLessThan(1e-5);
    }
  });

  it('inverts libjxl DCFromLowestFrequencies', () => {
    // Encoder side (libjxl enc_transforms DCFromLowestFrequencies): LF = IDCT(LLF * scale).
    const s = JxlAcStrategy.DCT32X16; // 2 wide, 4 tall in blocks
    const { blocksX: bw, blocksY: bh } = JXL_AC_STRATEGIES[s];
    const llf = Float32Array.from({ length: bw * bh }, rng(99));
    const lf = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) lf[y * bw + x] = llf[y * bw + x] * dctResampleScale(y, bh) * dctResampleScale(x, bw);
    inverseDct2d(lf, bw, bh);
    const block = new Float32Array(16 * 32);
    lowestFrequenciesFromLf(s, lf, 0, bw, block, 0, 16);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) expect(block[y * 16 + x]).toBeCloseTo(llf[y * bw + x], 5);
  });
});
