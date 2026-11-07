/**
 * VarDCT dequantization (ISO/IEC 18181-1 Annex I.2 / F.3): dequant matrix
 * parameter encodings and their default values, weight-matrix computation,
 * HF coefficient dequantization with quant biases, LF dequantization, adaptive
 * LF smoothing and chroma-from-luma.
 * Ported from libjxl quant_weights.cc / compressed_dc.cc / chroma_from_luma.h and
 * jxl-oxide jxl-vardct/dequant.rs, jxl-render/vardct/mod.rs.
 */

import { JXL_AC_STRATEGIES } from './jxlVardctTransforms.js';

type Params3 = readonly (readonly number[])[];

/**
 * One dequant matrix encoding (DequantMatrixParams). All arrays are per channel
 * (X, Y, B). `dctParams[c][0]` is the absolute first band (already x64 when read
 * from the bitstream); the rest are relative band multipliers.
 */
export type JxlQuantEncoding =
  | { readonly mode: 'identity'; readonly params: Params3 }
  | { readonly mode: 'dct2'; readonly params: Params3 }
  | { readonly mode: 'dct4'; readonly params: Params3; readonly dctParams: Params3 }
  | { readonly mode: 'dct4x8'; readonly params: Params3; readonly dctParams: Params3 }
  | { readonly mode: 'afv'; readonly params: Params3; readonly dctParams: Params3; readonly dct4x4Params: Params3 }
  | { readonly mode: 'dct'; readonly dctParams: Params3 }
  | { readonly mode: 'raw'; readonly denominator: number; readonly table: readonly Int32Array[] };

export const JXL_NUM_QUANT_TABLES = 17;

/** Wide (width >= height) matrix size for each quant table (jxl-oxide dequant_matrix_size). */
export const JXL_QUANT_TABLE_SIZES: ReadonlyArray<readonly [number, number]> = [
  [8, 8],
  [8, 8],
  [8, 8],
  [8, 8],
  [16, 16],
  [32, 32],
  [16, 8],
  [32, 8],
  [32, 16],
  [8, 8],
  [8, 8],
  [64, 64],
  [64, 32],
  [128, 128],
  [128, 64],
  [256, 256],
  [256, 128],
];

const SEQ_A = [-1.025, -0.78, -0.65012, -0.19041574084286472, -0.20819395464, -0.421064, -0.3273384553584867];
const SEQ_B = [
  -0.3041958212306401, -0.3633036457487539, -0.3566037999011146, -0.3443074455424403, -0.3369959268351247,
  -0.3018086652624211, -0.2732168312535804,
];
const SEQ_C = [-1.2, -1.2, -0.8, -0.7, -0.7, -0.4, -0.5];
const DCT4X8_PARAMS: Params3 = [
  [2198.0505560163806, -0.9626962302074469, -0.7619425302666678, -0.6551140670773546],
  [764.3655248643529, -0.9263020088836694, -0.9675229603596517, -0.27845290869168116],
  [527.1075735875422, -1.4594385811273853, -1.4500820940978716, -1.5843722511996203],
];
const DCT4_PARAMS: Params3 = [
  [2200, 0, 0, 0],
  [392, 0, 0, 0],
  [112, -0.25, -0.25, -0.5],
];
const commonSeq = (a: number, b: number, c: number): JxlQuantEncoding => ({
  mode: 'dct',
  dctParams: [
    [a, ...SEQ_A],
    [b, ...SEQ_B],
    [c, ...SEQ_C],
  ],
});

/** Library default encodings for the 17 quant tables (libjxl quant_weights.cc, kQuantModeLibrary). */
export const JXL_DEFAULT_QUANT_ENCODINGS: readonly JxlQuantEncoding[] = [
  {
    mode: 'dct',
    dctParams: [
      [3150, 0, -0.4, -0.4, -0.4, -2],
      [560, 0, -0.3, -0.3, -0.3, -0.3],
      [512, -2, -1, 0, -1, -2],
    ],
  },
  {
    mode: 'identity',
    params: [
      [280, 3160, 3160],
      [60, 864, 864],
      [18, 200, 200],
    ],
  },
  {
    mode: 'dct2',
    params: [
      [3840, 2560, 1280, 640, 480, 300],
      [960, 640, 320, 180, 140, 120],
      [640, 320, 128, 64, 32, 16],
    ],
  },
  {
    mode: 'dct4',
    params: [
      [1, 1],
      [1, 1],
      [1, 1],
    ],
    dctParams: DCT4_PARAMS,
  },
  {
    mode: 'dct',
    dctParams: [
      [
        8996.872571181411, -1.3000777393353804, -0.49424529824571223, -0.43909377445710346, -0.6350101832695744,
        -0.9017726405082761, -1.6162099239887413,
      ],
      [
        3191.4836629684423, -0.6742458210419435, -0.80745813428471, -0.4492583748484344, -0.35865440981033403,
        -0.313223891118773, -0.3761502531572548,
      ],
      [
        1157.504081454872, -2.053142316580441, -1.4, -0.5068713003337839, -0.42708730624733904, -1.4856834539296244,
        -4.92091428844016,
      ],
    ],
  },
  {
    mode: 'dct',
    dctParams: [
      [15718.408309825189, -1.025, -0.98, -0.9012, -0.4, -0.48819395464, -0.421064, -0.27],
      [
        7305.7636810695985, -0.8041958212306402, -0.7633036457487539, -0.5566037999011146, -0.49785304658857626,
        -0.43699592683512467, -0.4018086652624211, -0.2732168312535804,
      ],
      [
        3803.5317372121503, -3.060733579805728, -2.0413270132490346, -2.023565015972742, -0.5495389509954993, -0.4,
        -0.4, -0.3,
      ],
    ],
  },
  {
    mode: 'dct',
    dctParams: [
      [7240.7734393502, -0.7, -0.7, -0.2, -0.2, -0.2, -0.5],
      [1448.15468787004, -0.5, -0.5, -0.5, -0.2, -0.2, -0.2],
      [506.854140754517, -1.4, -0.2, -0.5, -0.5, -1.5, -3.6],
    ],
  },
  {
    mode: 'dct',
    dctParams: [
      [
        16283.24947106489, -1.7812845336559429, -1.6309059012653515, -1.038217903431354, -0.85, -0.7, -0.9,
        -1.2360638576849587,
      ],
      [5089.157508849215, -0.3200493914527869, -0.35362849922161443, -0.3034, -0.61, -0.5, -0.5, -0.6],
      [3397.7760327530873, -0.3213273626931534, -0.34507619223117997, -0.7034, -0.9, -1.0, -1.0, -1.175460557626521],
    ],
  },
  {
    mode: 'dct',
    dctParams: [
      [13844.970764423006, -0.971138, -0.658, -0.42026, -0.22712000000000002, -0.2206, -0.226, -0.6],
      [
        4798.964084220745, -0.6112530898276706, -0.8377078655249136, -0.7901486207949863, -0.2692727459704829,
        -0.3827276946538855, -0.22924222653091453, -0.20719098826199578,
      ],
      [1807.2369467609647, -1.2, -1.2, -0.7, -0.7, -0.7, -0.4, -0.5],
    ],
  },
  { mode: 'dct4x8', params: [[1], [1], [1]], dctParams: DCT4X8_PARAMS },
  {
    mode: 'afv',
    params: [
      [3072, 3072, 256, 256, 256, 414, 0, 0, 0],
      [1024, 1024, 50, 50, 50, 58, 0, 0, 0],
      [384, 384, 12, 12, 12, 22, -0.25, -0.25, -0.25],
    ],
    dctParams: DCT4X8_PARAMS,
    dct4x4Params: DCT4_PARAMS,
  },
  commonSeq(0.9 * 26629.073922049844, 0.9 * 9311.323871001005, 0.9 * 4992.248644553863),
  commonSeq(0.65 * 23629.073922049844, 0.65 * 8611.323871001005, 0.65 * 4492.248644553863),
  commonSeq(1.8 * 26629.073922049844, 1.8 * 9311.323871001005, 1.8 * 4992.248644553863),
  commonSeq(1.3 * 23629.073922049844, 1.3 * 8611.323871001005, 1.3 * 4492.248644553863),
  commonSeq(3.6 * 26629.073922049844, 3.6 * 9311.323871001005, 3.6 * 4992.248644553863),
  // libjxl values; jxl-oxide uses 2.6 * 9311.32 / 2.6 * 4992.25 for Y/B here.
  commonSeq(2.6 * 23629.073922049844, 2.6 * 8611.323871001005, 2.6 * 4492.248644553863),
];

/** libjxl Mult: maps a relative band parameter to a multiplier. */
export function quantMult(v: number): number {
  return v > 0 ? 1 + v : 1 / (1 - v);
}

/** libjxl Interpolate: geometric interpolation between bands at `pos` in `[0, max)`. */
export function quantInterpolate(pos: number, max: number, bands: ArrayLike<number>): number {
  const len = bands.length;
  if (len === 1) return bands[0]!;
  const scaled = (pos * (len - 1)) / max;
  const idx = Math.floor(scaled);
  const a = bands[idx]!;
  const b = bands[idx + 1]!;
  return a * Math.pow(b / a, scaled - idx);
}

function bandsFrom(params: readonly number[]): Float64Array {
  const bands = new Float64Array(params.length);
  bands[0] = params[0]!;
  if (!(bands[0] >= 1e-8)) throw new Error('JXL: invalid dequant distance bands');
  for (let i = 1; i < params.length; i++) {
    bands[i] = bands[i - 1]! * quantMult(params[i]!);
    if (!(bands[i]! >= 1e-8)) throw new Error('JXL: invalid dequant distance bands');
  }
  return bands;
}

/** libjxl GetQuantWeights: radial distance-band weights for a `width x height` DCT (row-major). */
export function dctQuantWeights(params: readonly number[], width: number, height: number): Float32Array {
  const bands = bandsFrom(params);
  const out = new Float32Array(width * height);
  const max = Math.SQRT2 + 1e-6;
  for (let y = 0; y < height; y++) {
    const dy = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const dx = x / (width - 1);
      out[y * width + x] = quantInterpolate(Math.sqrt(dx * dx + dy * dy), max, bands);
    }
  }
  return out;
}

const AFV_FREQS = [
  0, 0, 0.8517778890324296, 5.37778436506804, 0, 0, 4.734747904497923, 5.449245381693219, 1.6598270267479331, 4,
  7.275749096817861, 10.423227632456525, 2.662932286148962, 7.630657783650829, 8.962388608184032, 12.97166202570235,
];

function weightsForChannel(table: number, enc: JxlQuantEncoding, c: number): Float32Array {
  const [w, h] = JXL_QUANT_TABLE_SIZES[table]!;
  switch (enc.mode) {
    case 'dct':
      return dctQuantWeights(enc.dctParams[c]!, w, h);
    case 'identity': {
      const p = enc.params[c]!;
      const out = new Float32Array(64).fill(p[0]!);
      out[0] = 1;
      out[1] = out[8] = p[1]!;
      out[9] = p[2]!;
      return out;
    }
    case 'dct2': {
      const p = enc.params[c]!;
      const out = new Float32Array(64);
      out[0] = 1;
      for (let i = 0; i < 6; i++) {
        const dim = 1 << (i >> 1);
        for (let y = 0; y < dim * 2; y++) {
          for (let x = dim; x < dim * 2; x++) {
            if (i % 2 === 0) {
              if (y < dim) out[y * 8 + x] = out[x * 8 + y] = p[i]!;
            } else if (y >= dim) out[y * 8 + x] = p[i]!;
          }
        }
      }
      return out;
    }
    case 'dct4': {
      const m = dctQuantWeights(enc.dctParams[c]!, 4, 4);
      const out = new Float32Array(64);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out[y * 8 + x] = m[(y >> 1) * 4 + (x >> 1)]!;
      const p = enc.params[c]!;
      out[1] = out[1]! / p[0]!;
      out[8] = out[8]! / p[0]!;
      out[9] = out[9]! / p[1]!;
      return out;
    }
    case 'dct4x8': {
      const m = dctQuantWeights(enc.dctParams[c]!, 8, 4);
      const out = new Float32Array(64);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out[y * 8 + x] = m[(y >> 1) * 8 + x]!;
      out[8] = out[8]! / enc.params[c]![0]!;
      return out;
    }
    case 'afv': {
      const p = enc.params[c]!;
      const w4x8 = dctQuantWeights(enc.dctParams[c]!, 8, 4);
      const w4x4 = dctQuantWeights(enc.dct4x4Params[c]!, 4, 4);
      const bands = bandsFrom([p[5]!, p[6]!, p[7]!, p[8]!]);
      const lo = AFV_FREQS[2]!;
      const hi = AFV_FREQS[15]! - lo + 1e-6;
      const out = new Float32Array(64);
      out[0] = 1;
      out[8] = p[0]!;
      out[1] = p[1]!;
      out[16] = p[2]!;
      out[2] = p[3]!;
      out[18] = p[4]!;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          if (x < 2 && y < 2) continue;
          out[16 * y + 2 * x] = quantInterpolate(AFV_FREQS[y * 4 + x]! - lo, hi, bands);
        }
      }
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 8; x++) if (x || y) out[(2 * y + 1) * 8 + x] = w4x8[y * 8 + x]!;
        for (let x = 0; x < 4; x++) if (x || y) out[2 * y * 8 + 2 * x + 1] = w4x4[y * 4 + x]!;
      }
      return out;
    }
    default: {
      // Raw tables already hold multipliers (libjxl: weights = 1 / (den * q)).
      const t = enc.table[c]!;
      const out = new Float32Array(w * h);
      for (let i = 0; i < out.length; i++) out[i] = 1 / (t[i]! * enc.denominator);
      return out;
    }
  }
}

/**
 * Computes the three dequantization multiplier matrices (1 / weight, wide layout
 * `JXL_QUANT_TABLE_SIZES[table]`, row-major) for one quant table.
 * Throws on out-of-range weights like libjxl ComputeQuantTable.
 */
export function computeDequantMatrix(table: number, enc: JxlQuantEncoding): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < 3; c++) {
    const wts = weightsForChannel(table, enc, c);
    for (let i = 0; i < wts.length; i++) {
      const v = wts[i]!;
      if (!(v >= 1e-8 && v < 1e8)) throw new Error('JXL: invalid quantization table');
      wts[i] = 1 / v;
    }
    out.push(wts);
  }
  return out;
}

/** Full set of dequant matrices: `matrices[table][channel]` (wide) and transposed copies. */
export interface JxlDequantMatrices {
  readonly matrices: readonly (readonly Float32Array[])[];
  readonly transposed: readonly (readonly Float32Array[])[];
}

function transposeMatrix(m: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + y] = m[y * w + x]!;
  return out;
}

/** Builds a {@link JxlDequantMatrices} from 17 encodings (index = quant table). */
export function computeDequantMatrices(encodings: readonly JxlQuantEncoding[]): JxlDequantMatrices {
  const matrices = encodings.map((e, t) => computeDequantMatrix(t, e));
  const transposed = matrices.map((m, t) => {
    const [w, h] = JXL_QUANT_TABLE_SIZES[t]!;
    return m.map((ch) => transposeMatrix(ch, w, h));
  });
  return { matrices, transposed };
}

let defaultMatrices: JxlDequantMatrices | undefined;

/** Library-default dequant matrices (cached). */
export function computeDefaultDequantMatrices(): JxlDequantMatrices {
  defaultMatrices ??= computeDequantMatrices(JXL_DEFAULT_QUANT_ENCODINGS);
  return defaultMatrices;
}

/** Dequant multipliers for `strategy`/`channel` in pixel orientation (`blocksX*8` wide). */
export function dequantMatrixFor(set: JxlDequantMatrices, strategy: number, channel: number): Float32Array {
  const info = JXL_AC_STRATEGIES[strategy]!;
  return (info.transposed ? set.transposed : set.matrices)[info.quantTable]![channel]!;
}

/** libjxl kDefaultQuantBias (X, Y, B) and numerator. */
export const JXL_DEFAULT_QUANT_BIAS: readonly number[] = [
  1 - 0.05465007330715401,
  1 - 0.07005449891748593,
  1 - 0.049935103337343655,
];
export const JXL_DEFAULT_QUANT_BIAS_NUMERATOR = 0.145;

/**
 * Multiplier applied on top of the matrix for HF coefficients:
 * `65536 / (globalScale * hfMul) * 0.8^(qmScale - 2)` for X/B (`qmScale` from frame header), 1 for Y.
 */
export function hfDequantMultiplier(globalScale: number, hfMul: number, channel: number, qmScale = 2): number {
  const base = 65536 / (globalScale * hfMul);
  return channel === 1 ? base : base * Math.pow(0.8, qmScale - 2);
}

/**
 * Dequantizes a varblock of quantized HF coefficients (`quant`, pixel orientation,
 * `w x h` at `off`/`stride`) into `out` (same addressing): applies the
 * AdjustQuantBias rule then `matrix * mul`. LLF positions are overwritten later.
 */
export function dequantizeHfBlock(
  quant: Int32Array,
  out: Float32Array,
  off: number,
  stride: number,
  w: number,
  h: number,
  matrix: Float32Array,
  mul: number,
  quantBias: number,
  quantBiasNumerator: number,
): void {
  for (let y = 0; y < h; y++) {
    const row = off + y * stride;
    for (let x = 0; x < w; x++) {
      const q = quant[row + x]!;
      const v = q === 0 ? 0 : q === 1 || q === -1 ? q * quantBias : q - quantBiasNumerator / q;
      out[row + x] = v * matrix[y * w + x]! * mul;
    }
  }
}

/**
 * LF dequantization step for one channel: `mLf * 2^(9 - extraPrecision) / (globalScale * quantLf)`,
 * where `mLf` is the LfChannelDequantization header value (default 1/32, 1/4, 1/2).
 * With `extraPrecision = 0` this is also the adaptive-smoothing threshold factor.
 */
export function lfDequantScale(mLf: number, globalScale: number, quantLf: number, extraPrecision = 0): number {
  return (mLf * (1 << (9 - extraPrecision))) / (globalScale * quantLf);
}

/** Default LfChannelDequantization values (X, Y, B). */
export const JXL_DEFAULT_M_LF: readonly number[] = [1 / 32, 1 / 4, 1 / 2];

const LF_SELF = 0.052262735;
const LF_SIDE = 0.2034514;
const LF_DIAG = 0.03348292;

/**
 * Adaptive LF smoothing (libjxl compressed_dc.cc AdaptiveDCSmoothing) on three
 * full-resolution (non-subsampled) `width x height` LF planes, in place.
 * `factors` are the per-channel {@link lfDequantScale} values (extraPrecision 0).
 * ponytail: allocates copies of the planes per call (LF is 1/64 of the image).
 */
export function adaptiveLfSmoothing(
  planes: readonly Float32Array[],
  width: number,
  height: number,
  factors: readonly number[],
): void {
  if (width <= 2 || height <= 2) return;
  const src = planes.map((p) => p.slice(0, width * height));
  const wa = new Float32Array(3);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gap = 0.5;
      for (let c = 0; c < 3; c++) {
        const s = src[c]!;
        const i = y * width + x;
        const self = s[i]!;
        const side = s[i - 1]! + s[i + 1]! + s[i - width]! + s[i + width]!;
        const diag = s[i - width - 1]! + s[i - width + 1]! + s[i + width - 1]! + s[i + width + 1]!;
        const v = self * LF_SELF + side * LF_SIDE + diag * LF_DIAG;
        wa[c] = v;
        gap = Math.max(gap, Math.abs(v - self) / factors[c]!);
      }
      const scale = Math.max(0, 3 - 4 * gap);
      for (let c = 0; c < 3; c++) {
        const i = y * width + x;
        const self = src[c]![i]!;
        planes[c]![i] = (wa[c]! - self) * scale + self;
      }
    }
  }
}

/** Default chroma-from-luma parameters (LfChannelCorrelation). */
export const JXL_DEFAULT_COLOUR_FACTOR = 84;
export const JXL_DEFAULT_BASE_CORRELATION_X = 0;
export const JXL_DEFAULT_BASE_CORRELATION_B = 1;

/** CfL multiplier from a signed factor: `base + factor / colourFactor`. */
export function cflMultiplier(factor: number, colourFactor: number, baseCorrelation: number): number {
  return baseCorrelation + factor / colourFactor;
}

/** Applies LF chroma-from-luma: `x += kx * y`, `b += kb * y` over `n` samples. */
export function applyChromaFromLumaLf(
  x: Float32Array,
  y: Float32Array,
  b: Float32Array,
  n: number,
  kx: number,
  kb: number,
): void {
  for (let i = 0; i < n; i++) {
    const v = y[i]!;
    x[i] = x[i]! + kx * v;
    b[i] = b[i]! + kb * v;
  }
}

/**
 * Applies HF chroma-from-luma to dequantized coefficient planes (`width x height`,
 * `stride`) using per-64x64-tile signed factors `xFromY`/`bFromY` (`cflStride` per row,
 * tile (0,0) aligned with pixel (0,0)).
 */
export function applyChromaFromLumaHf(
  x: Float32Array,
  y: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  stride: number,
  xFromY: Int32Array,
  bFromY: Int32Array,
  cflStride: number,
  colourFactor = JXL_DEFAULT_COLOUR_FACTOR,
  baseX = JXL_DEFAULT_BASE_CORRELATION_X,
  baseB = JXL_DEFAULT_BASE_CORRELATION_B,
): void {
  for (let py = 0; py < height; py++) {
    const tileRow = (py >> 6) * cflStride;
    const row = py * stride;
    for (let tx = 0; tx * 64 < width; tx++) {
      const kx = baseX + xFromY[tileRow + tx]! / colourFactor;
      const kb = baseB + bFromY[tileRow + tx]! / colourFactor;
      const end = Math.min(width, tx * 64 + 64);
      for (let px = tx * 64; px < end; px++) {
        const v = y[row + px]!;
        x[row + px] = x[row + px]! + kx * v;
        b[row + px] = b[row + px]! + kb * v;
      }
    }
  }
}
