/**
 * VarDCT transform math (ISO/IEC 18181-1 Annex I): the 27 AC strategies, natural
 * coefficient orders, the scaled DCT, the special 8x8 transforms (IDENTITY,
 * DCT2x2, DCT4x4, DCT4x8/8x4, AFV) and LLF-from-LF reconstruction.
 * Ported from libjxl dec_transforms-inl.h / dct-inl.h and jxl-oxide jxl-render/vardct.
 *
 * Coefficient block layout used throughout this module ("pixel orientation"):
 * a row-major `width x height` block (pixel size of the varblock) where
 * `block[ky * stride + kx]` holds horizontal frequency `kx` and vertical
 * frequency `ky`. For the 8x8 special transforms (IDENTITY/DCT2/DCT4/4x8/8x4/AFV)
 * the layout is exactly libjxl's `coefficients[y * 8 + x]`. The libjxl
 * transposed storage of DCT blocks with `ROWS >= COLS` is absorbed by
 * {@link coeffOrderToBlockIndices} (jxl-oxide `need_transpose`).
 */

/** AC strategy (libjxl `AcStrategyType`, spec `DctSelect`) numeric ids. */
export const JxlAcStrategy = {
  DCT8: 0,
  IDENTITY: 1,
  DCT2X2: 2,
  DCT4X4: 3,
  DCT16X16: 4,
  DCT32X32: 5,
  DCT16X8: 6,
  DCT8X16: 7,
  DCT32X8: 8,
  DCT8X32: 9,
  DCT32X16: 10,
  DCT16X32: 11,
  DCT4X8: 12,
  DCT8X4: 13,
  AFV0: 14,
  AFV1: 15,
  AFV2: 16,
  AFV3: 17,
  DCT64X64: 18,
  DCT64X32: 19,
  DCT32X64: 20,
  DCT128X128: 21,
  DCT128X64: 22,
  DCT64X128: 23,
  DCT256X256: 24,
  DCT256X128: 25,
  DCT128X256: 26,
} as const;
export type JxlAcStrategyId = (typeof JxlAcStrategy)[keyof typeof JxlAcStrategy];
export const JXL_NUM_AC_STRATEGIES = 27;

/** Static per-strategy information. */
export interface JxlAcStrategyInfo {
  readonly name: string;
  /** Covered 8x8 blocks horizontally (libjxl covered_blocks_x). */
  readonly blocksX: number;
  /** Covered 8x8 blocks vertically (libjxl covered_blocks_y). */
  readonly blocksY: number;
  /** Index into the 17 dequant matrix parameter sets (libjxl QuantTable). */
  readonly quantTable: number;
  /** Index into the 13 coefficient orders (libjxl kStrategyOrder). */
  readonly orderId: number;
  /** Whether (x, y) of the natural/permuted order must be swapped for this strategy. */
  readonly transposed: boolean;
}

const RAW_INFO: ReadonlyArray<readonly [string, number, number, number, number]> = [
  ['DCT8', 1, 1, 0, 0],
  ['IDENTITY', 1, 1, 1, 1],
  ['DCT2X2', 1, 1, 2, 1],
  ['DCT4X4', 1, 1, 3, 1],
  ['DCT16X16', 2, 2, 4, 2],
  ['DCT32X32', 4, 4, 5, 3],
  ['DCT16X8', 1, 2, 6, 4],
  ['DCT8X16', 2, 1, 6, 4],
  ['DCT32X8', 1, 4, 7, 5],
  ['DCT8X32', 4, 1, 7, 5],
  ['DCT32X16', 2, 4, 8, 6],
  ['DCT16X32', 4, 2, 8, 6],
  ['DCT4X8', 1, 1, 9, 1],
  ['DCT8X4', 1, 1, 9, 1],
  ['AFV0', 1, 1, 10, 1],
  ['AFV1', 1, 1, 10, 1],
  ['AFV2', 1, 1, 10, 1],
  ['AFV3', 1, 1, 10, 1],
  ['DCT64X64', 8, 8, 11, 7],
  ['DCT64X32', 4, 8, 12, 8],
  ['DCT32X64', 8, 4, 12, 8],
  ['DCT128X128', 16, 16, 13, 9],
  ['DCT128X64', 8, 16, 14, 10],
  ['DCT64X128', 16, 8, 14, 10],
  ['DCT256X256', 32, 32, 15, 11],
  ['DCT256X128', 16, 32, 16, 12],
  ['DCT128X256', 32, 16, 16, 12],
];

/** Per-strategy table indexed by {@link JxlAcStrategyId}. */
export const JXL_AC_STRATEGIES: readonly JxlAcStrategyInfo[] = RAW_INFO.map(
  ([name, blocksX, blocksY, quantTable, orderId]) => ({
    name,
    blocksX,
    blocksY,
    quantTable,
    orderId,
    // Only real DCTs are transposed, and only when they are at least as tall as wide.
    transposed: orderId !== 1 && blocksY >= blocksX,
  }),
);

/** True for the 8x8 transforms that are not a plain DCT (they share coefficient order 1). */
export function isSpecialStrategy(strategy: number): boolean {
  return JXL_AC_STRATEGIES[strategy]!.orderId === 1;
}

/** Wide (width >= height) pixel size of each of the 13 coefficient orders. */
export const JXL_ORDER_BLOCK_SIZES: ReadonlyArray<readonly [number, number]> = [
  [8, 8],
  [8, 8],
  [16, 16],
  [32, 32],
  [16, 8],
  [32, 8],
  [32, 16],
  [64, 64],
  [64, 32],
  [128, 128],
  [128, 64],
  [256, 256],
  [256, 128],
];

const naturalOrderCache: (Uint16Array | undefined)[] = [];

/**
 * Natural coefficient order for `orderId` (libjxl coeff_order.cc / jxl-oxide hf_pass.rs):
 * interleaved `[x0, y0, x1, y1, ...]` in the wide layout. The first
 * `(w/8) * (h/8)` entries are the LLF positions. Cached; do not mutate.
 */
export function naturalCoeffOrder(orderId: number): Uint16Array {
  const cached = naturalOrderCache[orderId];
  if (cached) return cached;
  const [bw, bh] = JXL_ORDER_BLOCK_SIZES[orderId]!;
  const out = new Uint16Array(bw * bh * 2);
  const yScale = bw / bh;
  const lbw = bw / 8;
  const lbh = bh / 8;
  let idx = 0;
  for (; idx < lbw * lbh; idx++) {
    out[idx * 2] = idx % lbw;
    out[idx * 2 + 1] = Math.floor(idx / lbw);
  }
  for (let dist = 1; dist < 2 * bw; dist++) {
    const margin = Math.max(0, dist - bw);
    for (let order = margin; order < dist - margin; order++) {
      const odd = dist % 2 === 1;
      const x = odd ? order : dist - 1 - order;
      const y = odd ? dist - 1 - order : order;
      if (x < lbw && y < lbw) continue;
      if (y % yScale !== 0) continue;
      out[idx * 2] = x;
      out[idx * 2 + 1] = y / yScale;
      idx++;
    }
  }
  naturalOrderCache[orderId] = out;
  return out;
}

/**
 * Converts an (optionally permuted) order of `[x, y]` pairs for the strategy's
 * order id into linear indices of the pixel-orientation coefficient block
 * (`stride = blocksX * 8`), applying the transpose for tall/square DCTs.
 */
export function coeffOrderToBlockIndices(orderXY: Uint16Array, strategy: number): Uint32Array {
  const info = JXL_AC_STRATEGIES[strategy]!;
  const stride = info.blocksX * 8;
  const n = orderXY.length >> 1;
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const x = orderXY[i * 2]!;
    const y = orderXY[i * 2 + 1]!;
    out[i] = info.transposed ? x * stride + y : y * stride + x;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scaled DCT. Forward: X0 = mean(x), Xk = sqrt2/N * sum x_n cos(pi k (2n+1) / 2N).
// Inverse: x_n = X0 + sqrt2 * sum_{k>0} Xk cos(...). (libjxl ComputeScaled(I)DCT.)

const SQRT2 = Math.SQRT2;
const secHalfCache = new Map<number, Float32Array>();

function secHalf(n: number): Float32Array {
  let t = secHalfCache.get(n);
  if (!t) {
    t = new Float32Array(n / 2);
    for (let k = 0; k < n / 2; k++) t[k] = 0.5 / Math.cos(((2 * k + 1) / (2 * n)) * Math.PI);
    secHalfCache.set(n, t);
  }
  return t;
}

/** In-place 1D DCT of `io[off .. off+n)`; `s[soff .. soff+n)` is scratch. n must be a power of two. */
function dct1d(io: Float32Array, off: number, n: number, s: Float32Array, soff: number, inverse: boolean): void {
  if (n <= 1) return;
  if (n === 2) {
    const a = io[off]!;
    const b = io[off + 1]!;
    const m = inverse ? 1 : 0.5;
    io[off] = (a + b) * m;
    io[off + 1] = (a - b) * m;
    return;
  }
  const h = n >> 1;
  const sec = secHalf(n);
  const s1 = soff + h;
  if (!inverse) {
    for (let i = 0; i < h; i++) {
      const a = io[off + i]!;
      const b = io[off + n - 1 - i]!;
      s[soff + i] = (a + b) * 0.5;
      s[s1 + i] = (a - b) * 0.5 * sec[i]!;
    }
    dct1d(s, soff, h, io, off, false);
    dct1d(s, s1, h, io, off + h, false);
    s[s1] = s[s1]! * SQRT2;
    for (let i = 0; i < h - 1; i++) s[s1 + i] = s[s1 + i]! + s[s1 + i + 1]!;
    for (let i = 0; i < h; i++) {
      io[off + 2 * i] = s[soff + i]!;
      io[off + 2 * i + 1] = s[s1 + i]!;
    }
  } else {
    for (let i = 0; i < h; i++) {
      s[soff + i] = io[off + 2 * i]!;
      s[s1 + i] = io[off + 2 * i + 1]!;
    }
    for (let i = h - 1; i >= 1; i--) s[s1 + i] = s[s1 + i]! + s[s1 + i - 1]!;
    s[s1] = s[s1]! * SQRT2;
    dct1d(s, soff, h, io, off, true);
    dct1d(s, s1, h, io, off + h, true);
    for (let i = 0; i < h; i++) {
      const a = s[soff + i]!;
      const b = s[s1 + i]! * sec[i]!;
      io[off + i] = a + b;
      io[off + n - 1 - i] = a - b;
    }
  }
}

const colBuf = new Float32Array(256);
const dctScratch = new Float32Array(256);

function dct2d(
  block: Float32Array,
  off: number,
  stride: number,
  width: number,
  height: number,
  inverse: boolean,
): void {
  if (width > 1) {
    for (let y = 0; y < height; y++) dct1d(block, off + y * stride, width, dctScratch, 0, inverse);
  }
  if (height > 1) {
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) colBuf[y] = block[off + y * stride + x]!;
      dct1d(colBuf, 0, height, dctScratch, 0, inverse);
      for (let y = 0; y < height; y++) block[off + y * stride + x] = colBuf[y]!;
    }
  }
}

/** In-place forward 2D scaled DCT of a `width x height` block (powers of two, <= 256). */
export function forwardDct2d(block: Float32Array, width: number, height: number, off = 0, stride = width): void {
  dct2d(block, off, stride, width, height, false);
}

/** In-place inverse 2D scaled DCT of a `width x height` block (powers of two, <= 256). */
export function inverseDct2d(block: Float32Array, width: number, height: number, off = 0, stride = width): void {
  dct2d(block, off, stride, width, height, true);
}

// ---------------------------------------------------------------------------
// LLF from LF (libjxl LowestFrequenciesFromDC / ReinterpretingDCT).

/** libjxl DCTResampleScales for N = 256 (spec I.2.4); index `c << (5 - log2(blocks))`. */
const RESAMPLE_SCALE_256 = new Float32Array([
  1.0, 0.9996047255830407, 0.9984194528776054, 0.9964458326264695, 0.9936866130906366, 0.9901456355893141,
  0.9858278282666936, 0.9807391980963174, 0.9748868211368796, 0.9682788310563117, 0.9609244059440204,
  0.9528337534340876, 0.9440180941651672, 0.9344896436056892, 0.9242615922757944, 0.913348084400198, 0.9017641950288744,
  0.8895259056651056, 0.8766500784429904, 0.8631544288990163, 0.8490574973847023, 0.8343786191696513,
  0.8191378932865928, 0.8033561501721485, 0.7870549181591013, 0.7702563888779096, 0.7529833816270532,
  0.7352593067735488, 0.7171081282466044, 0.6985543251889097, 0.6796228528314652, 0.6603391026591464,
]);

/** Resample scale for LLF coefficient `c` of a transform spanning `blocks` 8x8 blocks in that axis. */
export function dctResampleScale(c: number, blocks: number): number {
  return RESAMPLE_SCALE_256[c << (5 - Math.log2(blocks))]!;
}

const llfTmp = new Float32Array(32 * 32);

/**
 * Writes the lowest-frequency `blocksX x blocksY` coefficients of a varblock into `block`
 * (pixel orientation, `blockStride`) from the dequantized LF image values at
 * `lf[lfOff + y * lfStride + x]`. For 1x1 strategies this is just the LF value.
 */
export function lowestFrequenciesFromLf(
  strategy: number,
  lf: Float32Array,
  lfOff: number,
  lfStride: number,
  block: Float32Array,
  blockOff: number,
  blockStride: number,
): void {
  const { blocksX: bw, blocksY: bh } = JXL_AC_STRATEGIES[strategy]!;
  if (bw === 1 && bh === 1) {
    block[blockOff] = lf[lfOff]!;
    return;
  }
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) llfTmp[y * bw + x] = lf[lfOff + y * lfStride + x]!;
  dct2d(llfTmp, 0, bw, bw, bh, false);
  for (let y = 0; y < bh; y++) {
    const sy = dctResampleScale(y, bh);
    for (let x = 0; x < bw; x++) {
      block[blockOff + y * blockStride + x] = llfTmp[y * bw + x]! / (sy * dctResampleScale(x, bw));
    }
  }
}

// ---------------------------------------------------------------------------
// Special 8x8 transforms (ported from jxl-oxide generic/transform.rs, which
// resolves libjxl's transposed IDCT conventions into pixel orientation).

/** libjxl k4x4AFVBasis: AFV basis vectors (row j = basis for coefficient j). */
export const AFV_BASIS: readonly Float32Array[] = [
  [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25],
  [
    0.876902929799142, 0.2206518106944235, -0.10140050393753763, -0.1014005039375375, 0.2206518106944236,
    -0.10140050393753777, -0.10140050393753772, -0.10140050393753763, -0.10140050393753758, -0.10140050393753769,
    -0.1014005039375375, -0.10140050393753768, -0.10140050393753768, -0.10140050393753759, -0.10140050393753763,
    -0.10140050393753741,
  ],
  [
    0.0, 0.0, 0.40670075830260755, 0.44444816619734445, 0.0, 0.0, 0.19574399372042936, 0.2929100136981264,
    -0.40670075830260716, -0.19574399372042872, 0.0, 0.11379074460448091, -0.44444816619734384, -0.29291001369812636,
    -0.1137907446044814, 0.0,
  ],
  [
    0.0, 0.0, -0.21255748058288748, 0.3085497062849767, 0.0, 0.4706702258572536, -0.1621205195722993, 0.0,
    -0.21255748058287047, -0.16212051957228327, -0.47067022585725277, -0.1464291867126764, 0.3085497062849487, 0.0,
    -0.14642918671266536, 0.4251149611657548,
  ],
  [0.0, -0.7071067811865474, 0.0, 0.0, Math.SQRT1_2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  [
    -0.4105377591765233, 0.6235485373547691, -0.06435071657946274, -0.06435071657946266, 0.6235485373547694,
    -0.06435071657946284, -0.0643507165794628, -0.06435071657946274, -0.06435071657946272, -0.06435071657946279,
    -0.06435071657946266, -0.06435071657946277, -0.06435071657946277, -0.06435071657946273, -0.06435071657946274,
    -0.0643507165794626,
  ],
  [
    0.0, 0.0, -0.4517556589999482, 0.15854503551840063, 0.0, -0.04038515160822202, 0.0074182263792423875,
    0.39351034269210167, -0.45175565899994635, 0.007418226379244351, 0.1107416575309343, 0.08298163094882051,
    0.15854503551839705, 0.3935103426921022, 0.0829816309488214, -0.45175565899994796,
  ],
  [
    0.0, 0.0, -0.304684750724869, 0.5112616136591823, 0.0, 0.0, -0.290480129728998, -0.06578701549142804,
    0.304684750724884, 0.2904801297290076, 0.0, -0.23889773523344604, -0.5112616136592012, 0.06578701549142545,
    0.23889773523345467, 0.0,
  ],
  [
    0.0, 0.0, 0.3017929516615495, 0.25792362796341184, 0.0, 0.16272340142866204, 0.09520022653475037, 0.0,
    0.3017929516615503, 0.09520022653475055, -0.16272340142866173, -0.35312385449816297, 0.25792362796341295, 0.0,
    -0.3531238544981624, -0.6035859033230976,
  ],
  [
    0.0, 0.0, 0.40824829046386274, 0.0, 0.0, 0.0, 0.0, -0.4082482904638628, -0.4082482904638635, 0.0, 0.0,
    -0.40824829046386296, 0.0, 0.4082482904638634, 0.408248290463863, 0.0,
  ],
  [
    0.0, 0.0, 0.1747866975480809, 0.0812611176717539, 0.0, 0.0, -0.3675398009862027, -0.307882213957909,
    -0.17478669754808135, 0.3675398009862011, 0.0, 0.4826689115059883, -0.08126111767175039, 0.30788221395790305,
    -0.48266891150598584, 0.0,
  ],
  [
    0.0, 0.0, -0.21105601049335784, 0.18567180916109802, 0.0, 0.0, 0.49215859013738733, -0.38525013709251915,
    0.21105601049335806, -0.49215859013738905, 0.0, 0.17419412659916217, -0.18567180916109904, 0.3852501370925211,
    -0.1741941265991621, 0.0,
  ],
  [
    0.0, 0.0, -0.14266084808807264, -0.3416446842253372, 0.0, 0.7367497537172237, 0.24627107722075148,
    -0.08574019035519306, -0.14266084808807344, 0.24627107722075137, 0.14883399227113567, -0.04768680350229251,
    -0.3416446842253373, -0.08574019035519267, -0.047686803502292804, -0.14266084808807242,
  ],
  [
    0.0, 0.0, -0.13813540350758585, 0.3302282550303788, 0.0, 0.08755115000587084, -0.07946706605909573,
    -0.4613374887461511, -0.13813540350758294, -0.07946706605910261, 0.49724647109535086, 0.12538059448563663,
    0.3302282550303805, -0.4613374887461554, 0.12538059448564315, -0.13813540350758452,
  ],
  [
    0.0, 0.0, -0.17437602599651067, 0.0702790691196284, 0.0, -0.2921026642334881, 0.3623817333531167, 0.0,
    -0.1743760259965108, 0.36238173335311646, 0.29210266423348785, -0.4326608024727445, 0.07027906911962818, 0.0,
    -0.4326608024727457, 0.34875205199302267,
  ],
  [
    0.0, 0.0, 0.11354987314994337, -0.07417504595810355, 0.0, 0.19402893032594343, -0.435190496523228,
    0.21918684838857466, 0.11354987314994257, -0.4351904965232251, 0.5550443808910661, -0.25468277124066463,
    -0.07417504595810233, 0.2191868483885728, -0.25468277124066413, 0.1135498731499429,
  ],
].map((row) => new Float32Array(row));

const c64 = new Float32Array(64);
const p64 = new Float32Array(64);
const t32 = new Float32Array(32);
const t16 = new Float32Array(16);
const afvPix = new Float32Array(16);

/** In-place 2x2 "IDCT" on the top-left SxS of the 8x8 `c64` (libjxl IDCT2TopBlock). */
function idct2Top(s: number): void {
  const n = s >> 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c00 = c64[y * 8 + x]!;
      const c01 = c64[y * 8 + x + n]!;
      const c10 = c64[(y + n) * 8 + x]!;
      const c11 = c64[(y + n) * 8 + x + n]!;
      p64[2 * y * 8 + 2 * x] = c00 + c01 + c10 + c11;
      p64[2 * y * 8 + 2 * x + 1] = c00 + c01 - c10 - c11;
      p64[(2 * y + 1) * 8 + 2 * x] = c00 - c01 + c10 - c11;
      p64[(2 * y + 1) * 8 + 2 * x + 1] = c00 - c01 - c10 + c11;
    }
  }
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) c64[y * 8 + x] = p64[y * 8 + x]!;
}

function transformDct4(): void {
  idct2Top(2);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      for (let iy = 0; iy < 4; iy++)
        for (let ix = 0; ix < 4; ix++) t16[ix * 4 + iy] = c64[(y + iy * 2) * 8 + x + ix * 2]!;
      dct2d(t16, 0, 4, 4, 4, true);
      for (let iy = 0; iy < 4; iy++)
        for (let ix = 0; ix < 4; ix++) p64[(y * 4 + iy) * 8 + x * 4 + ix] = t16[iy * 4 + ix]!;
    }
  }
}

function transformIdentity(): void {
  idct2Top(2);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      for (let iy = 0; iy < 4; iy++)
        for (let ix = 0; ix < 4; ix++) t16[iy * 4 + ix] = c64[(y + iy * 2) * 8 + x + ix * 2]!;
      let residual = 0;
      for (let i = 1; i < 16; i++) residual += t16[i]!;
      const avg = t16[0]! - residual / 16;
      t16[0] = t16[5]!;
      t16[5] = 0;
      for (let iy = 0; iy < 4; iy++)
        for (let ix = 0; ix < 4; ix++) p64[(y * 4 + iy) * 8 + x * 4 + ix] = t16[iy * 4 + ix]! + avg;
    }
  }
}

function transformDct4x8(transpose: boolean): void {
  const c0 = c64[0]!;
  const c1 = c64[8]!;
  c64[0] = c0 + c1;
  c64[8] = c0 - c1;
  for (let half = 0; half < 2; half++) {
    for (let iy = 0; iy < 4; iy++) for (let ix = 0; ix < 8; ix++) t32[iy * 8 + ix] = c64[(iy * 2 + half) * 8 + ix]!;
    dct2d(t32, 0, 8, 8, 4, true);
    for (let iy = 0; iy < 4; iy++) {
      for (let ix = 0; ix < 8; ix++) {
        const r = half * 4 + iy;
        if (transpose) p64[ix * 8 + r] = t32[iy * 8 + ix]!;
        else p64[r * 8 + ix] = t32[iy * 8 + ix]!;
      }
    }
  }
}

function transformAfv(kind: number): void {
  const flipX = kind & 1;
  const flipY = kind >> 1;
  const b00 = c64[0]!;
  const b01 = c64[1]!;
  const b10 = c64[8]!;
  // AFV 4x4 corner on (even, even) coefficients.
  t16[0] = (b00 + b01 + b10) * 4;
  for (let i = 1; i < 16; i++) t16[i] = c64[2 * (i >> 2) * 8 + 2 * (i & 3)]!;
  afvPix.fill(0);
  for (let j = 0; j < 16; j++) {
    const cf = t16[j]!;
    const basis = AFV_BASIS[j]!;
    for (let i = 0; i < 16; i++) afvPix[i] = afvPix[i]! + cf * basis[i]!;
  }
  for (let iy = 0; iy < 4; iy++) {
    const ay = flipY ? 3 - iy : iy;
    for (let ix = 0; ix < 4; ix++) {
      p64[(flipY * 4 + iy) * 8 + flipX * 4 + ix] = afvPix[ay * 4 + (flipX ? 3 - ix : ix)]!;
    }
  }
  // IDCT4x4 on (odd, even) coefficients, stored transposed.
  t16[0] = b00 - b01 + b10;
  for (let iy = 0; iy < 4; iy++) {
    for (let ix = 0; ix < 4; ix++) if (ix | iy) t16[ix * 4 + iy] = c64[2 * iy * 8 + 2 * ix + 1]!;
  }
  dct2d(t16, 0, 4, 4, 4, true);
  for (let iy = 0; iy < 4; iy++) {
    for (let ix = 0; ix < 4; ix++) p64[(flipY * 4 + iy) * 8 + (1 - flipX) * 4 + ix] = t16[iy * 4 + ix]!;
  }
  // IDCT4x8 on odd rows.
  t32[0] = b00 - b10;
  for (let iy = 0; iy < 4; iy++) {
    for (let ix = 0; ix < 8; ix++) if (ix | iy) t32[iy * 8 + ix] = c64[(2 * iy + 1) * 8 + ix]!;
  }
  dct2d(t32, 0, 8, 8, 4, true);
  for (let iy = 0; iy < 4; iy++)
    for (let ix = 0; ix < 8; ix++) p64[((1 - flipY) * 4 + iy) * 8 + ix] = t32[iy * 8 + ix]!;
}

/**
 * libjxl TransformToPixels: in-place inverse transform of a dequantized
 * coefficient block (pixel orientation, LLF already filled) at `block[off]` with
 * `stride`, producing `blocksX*8 x blocksY*8` pixels.
 */
export function transformToPixels(strategy: number, block: Float32Array, off = 0, stride?: number): void {
  const info = JXL_AC_STRATEGIES[strategy]!;
  const w = info.blocksX * 8;
  const h = info.blocksY * 8;
  const st = stride ?? w;
  if (info.orderId !== 1) {
    dct2d(block, off, st, w, h, true);
    return;
  }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) c64[y * 8 + x] = block[off + y * st + x]!;
  switch (strategy) {
    case JxlAcStrategy.DCT2X2:
      idct2Top(2);
      idct2Top(4);
      idct2Top(8);
      p64.set(c64);
      break;
    case JxlAcStrategy.DCT4X4:
      transformDct4();
      break;
    case JxlAcStrategy.IDENTITY:
      transformIdentity();
      break;
    case JxlAcStrategy.DCT4X8:
      transformDct4x8(false);
      break;
    case JxlAcStrategy.DCT8X4:
      transformDct4x8(true);
      break;
    default:
      transformAfv(strategy - JxlAcStrategy.AFV0);
  }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) block[off + y * st + x] = p64[y * 8 + x]!;
}
