/**
 * VarDCT frame decoding (ISO/IEC 18181-1 G.2-G.4, I): LfGroup quantized LF + HfMetadata, HfGlobal
 * (dequant matrices, coefficient orders, HF histograms), PassGroup AC coefficients, and the
 * reconstruction LF dequant -> smoothing -> HF dequant -> CfL -> LLF -> IDCT into XYB planes.
 * Ported from libjxl dec_modular.cc (DecodeVarDCTDC, DecodeAcMetadata), compressed_dc.cc,
 * quant_weights.cc, coeff_order.cc, dec_group.cc, ac_context.h; jxl-oxide jxl-vardct.
 */
import { type JxlBitReader, unpackSigned } from './jxlBitReader.js';
import { JxlEntropyDecoder, readPermutation } from './jxlEntropy.js';
import type { JxlFrameDimensions, JxlFrameHeader } from './jxlFrameHeader.js';
import type { JxlImageHeader } from './jxlImageHeader.js';
import type { JxlHfBlockContext, JxlLfGlobal } from './jxlLfGlobal.js';
import { applyInverseTransforms, decodeModularStream, modularStreamId } from './jxlModular.js';
import { epfSigma } from './jxlRestoration.js';
import {
  adaptiveLfSmoothing,
  computeDefaultDequantMatrices,
  computeDequantMatrices,
  dequantizeHfBlock,
  dequantMatrixFor,
  hfDequantMultiplier,
  JXL_DEFAULT_QUANT_ENCODINGS,
  JXL_QUANT_TABLE_SIZES,
  type JxlDequantMatrices,
  type JxlQuantEncoding,
  lfDequantScale,
} from './jxlVardctDequant.js';
import {
  JXL_AC_STRATEGIES,
  JXL_NUM_AC_STRATEGIES,
  JXL_ORDER_BLOCK_SIZES,
  lowestFrequenciesFromLf,
  naturalCoeffOrder,
  transformToPixels,
} from './jxlVardctTransforms.js';

// ---------------------------------------------------------------------------
// Contexts (libjxl ac_context.h)

/** libjxl kCoeffFreqContext (index 0 unused). */
const COEFF_FREQ_CONTEXT = new Uint8Array([
  0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22,
  23, 23, 23, 23, 24, 24, 24, 24, 25, 25, 25, 25, 26, 26, 26, 26, 27, 27, 27, 27, 28, 28, 28, 28, 29, 29, 29, 29, 30,
  30, 30, 30,
]);
/** libjxl kCoeffNumNonzeroContext (index 0 unused). */
const COEFF_NUM_NONZERO_CONTEXT = new Uint16Array([
  0, 0, 31, 62, 62, 93, 93, 93, 93, 123, 123, 123, 123, 152, 152, 152, 152, 152, 152, 152, 152, 180, 180, 180, 180, 180,
  180, 180, 180, 180, 180, 180, 180, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206,
  206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206,
]);
const NON_ZERO_BUCKETS = 37;
const ZERO_DENSITY_CONTEXT_COUNT = 458;

/** libjxl ZeroDensityContext: context of the AC coefficient at scan index `k` (>= coveredBlocks). */
export function zeroDensityContext(nonzerosLeft: number, k: number, log2Blocks: number, prev: number): number {
  const nz = (nonzerosLeft + (1 << log2Blocks) - 1) >> log2Blocks;
  return (COEFF_NUM_NONZERO_CONTEXT[nz]! + COEFF_FREQ_CONTEXT[k >> log2Blocks]!) * 2 + prev;
}

/** libjxl BlockCtxMap::NonZeroContext for a predicted non-zero count. */
export function nonZeroContext(predicted: number, blockCtx: number, numClusters: number): number {
  const nz = Math.min(predicted, 64);
  return (nz < 8 ? nz : 4 + (nz >> 1)) * numClusters + blockCtx;
}

/** libjxl BlockCtxMap::Context for channel `c` (0 = X, 1 = Y, 2 = B). */
export function blockContext(bc: JxlHfBlockContext, lfIdx: number, qf: number, orderId: number, c: number): number {
  let qfIdx = 0;
  for (const t of bc.qfThresholds) if (qf > t) qfIdx++;
  const idx = ((c < 2 ? c ^ 1 : 2) * 13 + orderId) * (bc.qfThresholds.length + 1) + qfIdx;
  return bc.ctxMap[idx * bc.numLfCtx + lfIdx]!;
}

function countAbove(t: Int32Array, v: number): number {
  let n = 0;
  for (const x of t) if (v > x) n++;
  return n;
}

/** libjxl DequantDC bucket of quantized LF values (X, Y, B). */
export function lfContext(bc: JxlHfBlockContext, qx: number, qy: number, qb: number): number {
  const [tx, ty, tb] = bc.lfThresholds;
  return (countAbove(tx, qx) * (tb.length + 1) + countAbove(tb, qb)) * (ty.length + 1) + countAbove(ty, qy);
}

const clamp8 = (v: number) => Math.max(-128, Math.min(127, v));
const ceilLog2 = (n: number) => (n <= 1 ? 0 : 32 - Math.clz32(n - 1));

// ---------------------------------------------------------------------------
// HfGlobal

export interface JxlHfPass {
  /** Coefficient orders `[orderId][channel]` as interleaved (x, y) pairs (wide layout). */
  orders: Uint16Array[][];
  decoder: JxlEntropyDecoder;
}

export interface JxlHfGlobal {
  dequant: JxlDequantMatrices;
  numHfPresets: number;
  passes: JxlHfPass[];
}

function readF16Params(br: JxlBitReader, n: number, scaled: number): number[][] {
  const out: number[][] = [];
  for (let c = 0; c < 3; c++) {
    const p: number[] = [];
    for (let i = 0; i < n; i++) p.push(br.readF16() * (i < scaled ? 64 : 1));
    out.push(p);
  }
  return out;
}

/** libjxl DecodeDctParams (first band x64). */
function readDctParams(br: JxlBitReader): number[][] {
  const n = br.readBits(4) + 1;
  const out = readF16Params(br, n, 1);
  for (const p of out) if (!(p[0]! >= 64e-8)) throw new Error('JXL: invalid DCT quant params');
  return out;
}

/** One quant table encoding (libjxl quant_weights.cc Decode). Raw tables are Modular images. */
export function readQuantEncoding(
  br: JxlBitReader,
  table: number,
  lfg: JxlLfGlobal,
  numLfGroups: number,
): JxlQuantEncoding {
  const mode = br.readBits(3);
  const [w, h] = JXL_QUANT_TABLE_SIZES[table]!;
  if (mode >= 1 && mode <= 5 && w * h !== 64) throw new Error('JXL: invalid quant table mode');
  switch (mode) {
    case 0:
      return JXL_DEFAULT_QUANT_ENCODINGS[table]!;
    case 1:
      return { mode: 'identity', params: readF16Params(br, 3, 3) };
    case 2:
      return { mode: 'dct2', params: readF16Params(br, 6, 6) };
    case 3: {
      const params = readF16Params(br, 2, 0);
      return { mode: 'dct4', params, dctParams: readDctParams(br) };
    }
    case 4: {
      const params = readF16Params(br, 1, 0);
      return { mode: 'dct4x8', params, dctParams: readDctParams(br) };
    }
    case 5: {
      const params = readF16Params(br, 9, 6);
      const dctParams = readDctParams(br);
      return { mode: 'afv', params, dctParams, dct4x4Params: readDctParams(br) };
    }
    case 6:
      return { mode: 'dct', dctParams: readDctParams(br) };
    default: {
      const denominator = br.readF16();
      if (!(denominator >= 1e-8)) throw new Error('JXL: invalid raw quant table denominator');
      // libjxl DecodeQuantTable: image is (8 * required_size_x) wide = the narrow side; data is used flat.
      const info = { width: h, height: w, hshift: 0, vshift: 0 };
      const img = decodeModularStream(br, [info, info, info], {
        globalTree: lfg.globalTree,
        globalDecoder: lfg.globalDecoder,
        streamId: modularStreamId('quantTable', table, numLfGroups),
      });
      applyInverseTransforms(img);
      const tables = img.channels.map((ch) => ch.data);
      for (const t of tables) for (const v of t) if (v <= 0) throw new Error('JXL: invalid raw quant table');
      return { mode: 'raw', denominator, table: tables };
    }
  }
}

/** libjxl DequantMatrices::Decode. */
export function readDequantMatrices(br: JxlBitReader, lfg: JxlLfGlobal, numLfGroups: number): JxlDequantMatrices {
  if (br.readBool()) return computeDefaultDequantMatrices();
  const encs: JxlQuantEncoding[] = [];
  for (let t = 0; t < JXL_QUANT_TABLE_SIZES.length; t++) encs.push(readQuantEncoding(br, t, lfg, numLfGroups));
  return computeDequantMatrices(encs);
}

/** libjxl DecodeCoeffOrders: per-order/channel permutations of the natural order (LLF entries kept). */
export function readCoeffOrders(br: JxlBitReader, usedOrders: number): Uint16Array[][] {
  const orders: Uint16Array[][] = [];
  const dec = usedOrders ? JxlEntropyDecoder.read(br, 8) : undefined;
  for (let o = 0; o < 13; o++) {
    const nat = naturalCoeffOrder(o);
    if (!dec || !((usedOrders >> o) & 1)) {
      orders.push([nat, nat, nat]);
      continue;
    }
    const [bw, bh] = JXL_ORDER_BLOCK_SIZES[o]!;
    const size = bw * bh;
    const perC: Uint16Array[] = [];
    for (let c = 0; c < 3; c++) {
      const perm = readPermutation(br, dec, size, size / 64);
      const out = new Uint16Array(size * 2);
      for (let i = 0; i < size; i++) {
        out[i * 2] = nat[perm[i]! * 2]!;
        out[i * 2 + 1] = nat[perm[i]! * 2 + 1]!;
      }
      perC.push(out);
    }
    orders.push(perC);
  }
  dec?.finish();
  return orders;
}

/** HfGlobal section (jxl-oxide HfGlobal::parse / libjxl FrameDecoder::ProcessACGlobal). */
export function readHfGlobal(
  br: JxlBitReader,
  fh: JxlFrameHeader,
  dims: JxlFrameDimensions,
  lfg: JxlLfGlobal,
): JxlHfGlobal {
  const dequant = readDequantMatrices(br, lfg, dims.numLfGroups);
  const numHfPresets = br.readBits(ceilLog2(dims.numGroups)) + 1;
  const passes: JxlHfPass[] = [];
  for (let p = 0; p < fh.passes.numPasses; p++) {
    const usedOrders = br.readU32(0x5f, 0x13, 0, { bits: 13 });
    const orders = readCoeffOrders(br, usedOrders);
    const decoder = JxlEntropyDecoder.read(br, 495 * numHfPresets * lfg.blockCtx!.numClusters);
    passes.push({ orders, decoder });
  }
  return { dequant, numHfPresets, passes };
}

// ---------------------------------------------------------------------------
// Frame-wide VarDCT state

const UNINIT = 0xff;
const COVERED = 0xfe;
const H_SHIFT = [0, 1, 1, 0];
const V_SHIFT = [0, 1, 0, 1];

export interface JxlVardctImage {
  /** Frame size in 8x8 blocks. */
  bw: number;
  bh: number;
  /** Per-channel (X, Y, B) chroma subsampling shifts (libjxl YCbCrChromaSubsampling::HShift/VShift). */
  hs: number[];
  vs: number[];
  /** Dequantized LF (X, Y, B) per channel, `(bw >> hs) * (bh >> vs)`; LF CfL applied for 4:4:4. */
  lf: Float32Array[];
  /** LF context bucket per block. */
  lfIdx: Uint8Array;
  /** AC strategy of each varblock's first block; COVERED / UNINIT otherwise. */
  strategy: Uint8Array;
  /** Quant field (HfMul) of the varblock covering each block. */
  qf: Int32Array;
  sharpness: Uint8Array;
  /** Per-64x64-tile chroma-from-luma factors, `tw * th`. */
  xFromY: Int32Array;
  bFromY: Int32Array;
  tw: number;
  /** Quantized coefficients per channel, `((bw >> hs) * 8) x ((bh >> vs) * 8)`, accumulated over passes. */
  coeffs: Int32Array[];
  /** Per-pass, per-strategy, per-channel coefficient offsets in the coefficient planes (lazy). */
  orderOffsets: (Int32Array | undefined)[];
}

/** ponytail: full-frame Int32 coefficient planes (12 bytes/pixel); decode+reconstruct per group if memory matters. */
export function createVardctImage(fh: JxlFrameHeader, dims: JxlFrameDimensions): JxlVardctImage {
  const { xsizeBlocks: bw, ysizeBlocks: bh } = dims;
  const n = bw * bh;
  const tw = Math.ceil(bw / 8);
  const th = Math.ceil(bh / 8);
  const hs = fh.jpegUpsampling.map((m) => dims.maxHShift - H_SHIFT[m]!);
  const vs = fh.jpegUpsampling.map((m) => dims.maxVShift - V_SHIFT[m]!);
  const cn = (c: number) => (bw >> hs[c]!) * (bh >> vs[c]!);
  return {
    bw,
    bh,
    hs,
    vs,
    lf: [0, 1, 2].map((c) => new Float32Array(cn(c))),
    lfIdx: new Uint8Array(n),
    strategy: new Uint8Array(n).fill(UNINIT),
    qf: new Int32Array(n),
    sharpness: new Uint8Array(n),
    xFromY: new Int32Array(tw * th),
    bFromY: new Int32Array(tw * th),
    tw,
    coeffs: [0, 1, 2].map((c) => new Int32Array(cn(c) * 64)),
    orderOffsets: [],
  };
}

const is444 = (img: JxlVardctImage) => img.hs.every((s) => s === 0) && img.vs.every((s) => s === 0);

/** Block rect of LF group `g` (libjxl FrameDimensions::DCGroupRect). */
function lfGroupBlocks(img: JxlVardctImage, dims: JxlFrameDimensions, g: number) {
  const bx0 = (g % dims.lfGroupsPerRow) * dims.groupDim;
  const by0 = Math.floor(g / dims.lfGroupsPerRow) * dims.groupDim;
  return { bx0, by0, gbw: Math.min(dims.groupDim, img.bw - bx0), gbh: Math.min(dims.groupDim, img.bh - by0) };
}

/** VarDCT LF coefficients of LF group `g` (libjxl DecodeVarDCTDC + DequantDC). */
export function readLfCoeffs(
  br: JxlBitReader,
  img: JxlVardctImage,
  lfg: JxlLfGlobal,
  dims: JxlFrameDimensions,
  g: number,
): void {
  const ep = br.readBits(2);
  const { bx0, by0, gbw, gbh } = lfGroupBlocks(img, dims, g);
  // Modular channel order is Y, X, B.
  const xyb = [1, 0, 2];
  const m = decodeModularStream(
    br,
    xyb.map((c) => ({ width: gbw >> img.hs[c]!, height: gbh >> img.vs[c]!, hshift: 0, vshift: 0 })),
    {
      globalTree: lfg.globalTree,
      globalDecoder: lfg.globalDecoder,
      streamId: modularStreamId('vardctLf', g, dims.numLfGroups),
    },
  );
  applyInverseTransforms(m);
  const { globalScale, quantLf } = lfg.quantizer!;
  const q = [m.channels[1]!.data, m.channels[0]!.data, m.channels[2]!.data];
  for (let c = 0; c < 3; c++) {
    const mul = lfDequantScale(lfg.mLf[c]!, globalScale, quantLf, ep);
    const w = gbw >> img.hs[c]!;
    const stride = img.bw >> img.hs[c]!;
    const qc = q[c]!;
    const lc = img.lf[c]!;
    for (let y = 0; y < gbh >> img.vs[c]!; y++) {
      const o = ((by0 >> img.vs[c]!) + y) * stride + (bx0 >> img.hs[c]!);
      for (let x = 0; x < w; x++) lc[o + x] = qc[y * w + x]! * mul;
    }
  }
  if (is444(img)) {
    const cfl = lfg.cfl!;
    const kx = cfl.baseCorrelationX + (cfl.xFactorLf - 128) / cfl.colourFactor;
    const kb = cfl.baseCorrelationB + (cfl.bFactorLf - 128) / cfl.colourFactor;
    const lx = img.lf[0]!;
    const ly = img.lf[1]!;
    const lb = img.lf[2]!;
    for (let y = 0; y < gbh; y++) {
      for (let x = 0, o = (by0 + y) * img.bw + bx0; x < gbw; x++, o++) {
        lx[o] = lx[o]! + kx * ly[o]!;
        lb[o] = lb[o]! + kb * ly[o]!;
      }
    }
  }
  const bc = lfg.blockCtx!;
  if (bc.numLfCtx <= 1) return;
  const [qx, qy, qb] = [0, 1, 2].map((c) => (x: number, y: number) => {
    const w = gbw >> img.hs[c]!;
    return q[c]![(y >> img.vs[c]!) * w + (x >> img.hs[c]!)]!;
  });
  for (let y = 0; y < gbh; y++) {
    for (let x = 0; x < gbw; x++) {
      img.lfIdx[(by0 + y) * img.bw + bx0 + x] = lfContext(bc, qx!(x, y), qy!(x, y), qb!(x, y));
    }
  }
}

/** HfMetadata of LF group `g` (libjxl DecodeAcMetadata): CfL maps, AC strategies, quant field, EPF sharpness. */
export function readHfMetadata(
  br: JxlBitReader,
  img: JxlVardctImage,
  lfg: JxlLfGlobal,
  dims: JxlFrameDimensions,
  g: number,
): void {
  const { bx0, by0, gbw, gbh } = lfGroupBlocks(img, dims, g);
  const nbBlocks = 1 + br.readBits(ceilLog2(gbw * gbh));
  const tw = Math.ceil(gbw / 8);
  const th = Math.ceil(gbh / 8);
  const m = decodeModularStream(
    br,
    [
      { width: tw, height: th, hshift: 0, vshift: 0 },
      { width: tw, height: th, hshift: 0, vshift: 0 },
      { width: nbBlocks, height: 2, hshift: 0, vshift: 0 },
      { width: gbw, height: gbh, hshift: 0, vshift: 0 },
    ],
    {
      globalTree: lfg.globalTree,
      globalDecoder: lfg.globalDecoder,
      streamId: modularStreamId('hfMeta', g, dims.numLfGroups),
    },
  );
  applyInverseTransforms(m);
  const xfy = m.channels[0]!.data;
  const bfy = m.channels[1]!.data;
  const acs = m.channels[2]!.data;
  const sharp = m.channels[3]!.data;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const o = (by0 / 8 + y) * img.tw + bx0 / 8 + x;
      img.xFromY[o] = clamp8(xfy[y * tw + x]!);
      img.bFromY[o] = clamp8(bfy[y * tw + x]!);
    }
  }
  const sub = !is444(img);
  let num = 0;
  for (let y = 0; y < gbh; y++) {
    for (let x = 0; x < gbw; x++) {
      const o = (by0 + y) * img.bw + bx0 + x;
      const s = sharp[y * gbw + x]!;
      if (s < 0 || s > 7) throw new Error('JXL: invalid EPF sharpness');
      img.sharpness[o] = s;
      if (img.strategy[o] !== UNINIT) continue;
      if (num >= nbBlocks) throw new Error('JXL: corrupted AC metadata');
      const strategy = acs[num]!;
      if (strategy < 0 || strategy >= JXL_NUM_AC_STRATEGIES) throw new Error('JXL: invalid AC strategy');
      const qf = 1 + Math.max(0, Math.min(255, acs[nbBlocks + num]!));
      num++;
      const { blocksX, blocksY } = JXL_AC_STRATEGIES[strategy]!;
      const ax = bx0 + x;
      const ay = by0 + y;
      if ((ax & 31) + blocksX > 32 || (ay & 31) + blocksY > 32 || x + blocksX > gbw || y + blocksY > gbh) {
        throw new Error('JXL: invalid AC strategy placement');
      }
      if (sub && blocksX * blocksY > 1) throw new Error('JXL: AC strategy incompatible with chroma subsampling');
      for (let dy = 0; dy < blocksY; dy++) {
        for (let dx = 0; dx < blocksX; dx++) {
          const oo = o + dy * img.bw + dx;
          if (img.strategy[oo] !== UNINIT) throw new Error('JXL: overlapping varblocks');
          img.strategy[oo] = dx || dy ? COVERED : strategy;
          img.qf[oo] = qf;
        }
      }
    }
  }
}

/** Coefficient offsets of order `[orderId][c]` for `strategy` in channel `c`'s plane (jxl-oxide need_transpose). */
function orderOffsets(img: JxlVardctImage, hfg: JxlHfGlobal, pass: number, strategy: number, c: number): Int32Array {
  const key = (pass * JXL_NUM_AC_STRATEGIES + strategy) * 3 + c;
  let off = img.orderOffsets[key];
  if (off) return off;
  const info = JXL_AC_STRATEGIES[strategy]!;
  const order = hfg.passes[pass]!.orders[info.orderId]![c]!;
  const stride = (img.bw >> img.hs[c]!) * 8;
  off = new Int32Array(order.length >> 1);
  for (let i = 0; i < off.length; i++) {
    const x = order[i * 2]!;
    const y = order[i * 2 + 1]!;
    off[i] = info.transposed ? x * stride + y : y * stride + x;
  }
  img.orderOffsets[key] = off;
  return off;
}

const CHANNEL_ORDER = [1, 0, 2] as const;

/** VarDCT part of PassGroup `g` in pass `pass` (libjxl DecodeGroupImpl / DecodeACVarBlock). */
export function readPassGroup(
  br: JxlBitReader,
  img: JxlVardctImage,
  lfg: JxlLfGlobal,
  hfg: JxlHfGlobal,
  fh: JxlFrameHeader,
  dims: JxlFrameDimensions,
  pass: number,
  g: number,
): void {
  const bc = lfg.blockCtx!;
  const numClusters = bc.numClusters;
  const gdb = dims.groupDim / 8;
  const bx0 = (g % dims.groupsPerRow) * gdb;
  const by0 = Math.floor(g / dims.groupsPerRow) * gdb;
  const gbw = Math.min(gdb, img.bw - bx0);
  const gbh = Math.min(gdb, img.bh - by0);
  const hfp = br.readBits(ceilLog2(hfg.numHfPresets));
  if (hfp >= hfg.numHfPresets) throw new Error('JXL: invalid HF preset');
  const ctxOff = 495 * numClusters * hfp;
  const dec = hfg.passes[pass]!.decoder.clone();
  dec.begin(br);
  const shiftMul = 2 ** (fh.passes.shift[pass] ?? 0);
  const { hs, vs } = img;
  // Non-zero counts per channel at the channel's (subsampled) block resolution.
  const nzw = hs.map((s) => gbw >> s);
  const nzGrid = [0, 1, 2].map((c) => new Uint8Array(nzw[c]! * (gbh >> vs[c]!)));
  for (let by = 0; by < gbh; by++) {
    for (let bx = 0; bx < gbw; bx++) {
      const o = (by0 + by) * img.bw + bx0 + bx;
      const strategy = img.strategy[o]!;
      if (strategy >= COVERED) continue;
      const info = JXL_AC_STRATEGIES[strategy]!;
      const nb = info.blocksX * info.blocksY;
      const log2 = 31 - Math.clz32(nb);
      const size = nb * 64;
      const qf = img.qf[o]!;
      const lfIdx = img.lfIdx[o]!;
      for (const c of CHANNEL_ORDER) {
        const hc = hs[c]!;
        const vc = vs[c]!;
        const sbx = bx >> hc;
        const sby = by >> vc;
        if (sbx << hc !== bx || sby << vc !== by) continue;
        const nzc = nzGrid[c]!;
        const gw = nzw[c]!;
        const gi = sby * gw + sbx;
        const blockCtx = blockContext(bc, lfIdx, qf, info.orderId, c);
        const predicted =
          sbx === 0
            ? sby === 0
              ? 32
              : nzc[gi - gw]!
            : sby === 0
              ? nzc[gi - 1]!
              : (nzc[gi - gw]! + nzc[gi - 1]! + 1) >> 1;
        let nz = dec.readUint(br, ctxOff + nonZeroContext(predicted, blockCtx, numClusters));
        if (nz > size - nb) throw new Error('JXL: invalid AC non-zero count');
        const nzBlock = (nz + nb - 1) >> log2;
        for (let dy = 0; dy < info.blocksY; dy++) nzc.fill(nzBlock, gi + dy * gw, gi + dy * gw + info.blocksX);
        if (nz === 0) continue;
        const histo = ctxOff + numClusters * NON_ZERO_BUCKETS + ZERO_DENSITY_CONTEXT_COUNT * blockCtx;
        const order = orderOffsets(img, hfg, pass, strategy, c);
        const coeffs = img.coeffs[c]!;
        const stride = (img.bw >> hs[c]!) * 8;
        const base = (((by0 >> vs[c]!) + sby) * stride + (bx0 >> hs[c]!) + sbx) * 8;
        let prev = nz > nb * 4 ? 0 : 1;
        for (let k = nb; k < size && nz > 0; k++) {
          const u = dec.readUint(br, histo + zeroDensityContext(nz, k, log2, prev));
          if (u === 0) {
            prev = 0;
            continue;
          }
          const p = base + order[k]!;
          coeffs[p] = (coeffs[p]! + unpackSigned(u) * shiftMul) | 0;
          prev = 1;
          nz--;
        }
        if (nz !== 0) throw new Error('JXL: invalid AC coefficients');
      }
    }
  }
  dec.finish();
}

// ---------------------------------------------------------------------------
// Reconstruction

export interface JxlVardctOutput {
  /** XYB (or YCbCr / RGB) planes, `dims.width x dims.height` (chroma already upsampled). */
  planes: Float32Array[];
  /** EPF sigma per 8x8 block (`bw` stride), when EPF is enabled. */
  sigma?: Float32Array;
}

/**
 * libjxl stage_chroma_upsampling: 2x upsampling of one axis with (3/4, 1/4) weights and
 * mirrored borders. Returns a `(w * 2) x h` (horizontal) or `w x (h * 2)` plane.
 */
export function upsampleChroma2x(p: Float32Array, w: number, h: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(w * h * 2);
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const cur = 0.75 * p[row + x]!;
        out[(row + x) * 2] = cur + 0.25 * p[row + Math.max(0, x - 1)]!;
        out[(row + x) * 2 + 1] = cur + 0.25 * p[row + Math.min(w - 1, x + 1)]!;
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      const top = Math.max(0, y - 1) * w;
      const bot = Math.min(h - 1, y + 1) * w;
      for (let x = 0; x < w; x++) {
        const cur = 0.75 * p[y * w + x]!;
        out[2 * y * w + x] = cur + 0.25 * p[top + x]!;
        out[(2 * y + 1) * w + x] = cur + 0.25 * p[bot + x]!;
      }
    }
  }
  return out;
}

/** Crop a `stride`-wide plane to `w x h`. */
function crop(p: Float32Array, stride: number, w: number, h: number): Float32Array {
  if (stride === w && p.length === w * h) return p;
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) o.set(p.subarray(y * stride, y * stride + w), y * w);
  return o;
}

/**
 * Reconstruct the XYB image: LF smoothing (unless skipped / LF frame), then per varblock
 * dequantizeHfBlock -> CfL -> lowestFrequenciesFromLf -> transformToPixels (libjxl dec_group.cc),
 * then chroma upsampling of subsampled channels.
 * `lfFrame` (XYB planes at 1/8 resolution, `width` wide) replaces the LF image when `useLfFrame`.
 */
export function reconstructVardct(
  img: JxlVardctImage,
  lfg: JxlLfGlobal,
  hfg: JxlHfGlobal,
  h: JxlImageHeader,
  fh: JxlFrameHeader,
  dims: JxlFrameDimensions,
  lfFrame?: { planes: Float32Array[]; width: number },
): JxlVardctOutput {
  const { bw, bh, hs, vs } = img;
  const { globalScale, quantLf } = lfg.quantizer!;
  let lf = img.lf;
  if (fh.useLfFrame) {
    if (!lfFrame) throw new Error('JXL: missing LF frame');
    lf = lfFrame.planes.map((p) => crop(p, lfFrame.width, bw, bh));
  } else if (!fh.skipAdaptiveLfSmoothing && is444(img)) {
    adaptiveLfSmoothing(
      lf,
      bw,
      bh,
      lfg.mLf.map((m) => lfDequantScale(m, globalScale, quantLf)),
    );
  }
  const strides = hs.map((s) => (bw >> s) * 8);
  const planes = [0, 1, 2].map((c) => new Float32Array(strides[c]! * (bh >> vs[c]!) * 8));
  const { quantBias, quantBiasNumerator } = h.opsinInverse;
  const cfl = lfg.cfl!;
  const qm = [fh.xQmScale, 2, fh.bQmScale];
  const offs = [0, 0, 0];
  const lfOffs = [0, 0, 0];
  const aligned = [false, false, false];
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const o = by * bw + bx;
      const strategy = img.strategy[o]!;
      if (strategy >= COVERED) continue;
      const info = JXL_AC_STRATEGIES[strategy]!;
      const w = info.blocksX * 8;
      const hh = info.blocksY * 8;
      const qf = img.qf[o]!;
      for (let c = 0; c < 3; c++) {
        const hc = hs[c]!;
        const vc = vs[c]!;
        const sbx = bx >> hc;
        const sby = by >> vc;
        aligned[c] = sbx << hc === bx && sby << vc === by;
        if (!aligned[c]) continue;
        offs[c] = sby * 8 * strides[c]! + sbx * 8;
        lfOffs[c] = sby * (bw >> hs[c]!) + sbx;
        dequantizeHfBlock(
          img.coeffs[c]!,
          planes[c]!,
          offs[c]!,
          strides[c]!,
          w,
          hh,
          dequantMatrixFor(hfg.dequant, strategy, c),
          hfDequantMultiplier(globalScale, qf, c, qm[c]),
          quantBias[c]!,
          quantBiasNumerator,
        );
      }
      // HF chroma-from-luma with the factors of the tile holding the varblock's first block.
      if (aligned[1]) {
        const tile = (by >> 3) * img.tw + (bx >> 3);
        const k = [
          cfl.baseCorrelationX + img.xFromY[tile]! / cfl.colourFactor,
          0,
          cfl.baseCorrelationB + img.bFromY[tile]! / cfl.colourFactor,
        ];
        const py = planes[1]!;
        for (const c of [0, 2]) {
          if (!aligned[c] || k[c] === 0) continue;
          const pc = planes[c]!;
          const kc = k[c]!;
          for (let y = 0; y < hh; y++) {
            const iy = offs[1]! + y * strides[1]!;
            const ic = offs[c]! + y * strides[c]!;
            for (let x = 0; x < w; x++) pc[ic + x] = pc[ic + x]! + kc * py[iy + x]!;
          }
        }
      }
      for (let c = 0; c < 3; c++) {
        if (!aligned[c]) continue;
        lowestFrequenciesFromLf(strategy, lf[c]!, lfOffs[c]!, bw >> hs[c]!, planes[c]!, offs[c]!, strides[c]!);
        transformToPixels(strategy, planes[c]!, offs[c], strides[c]);
      }
    }
  }
  const out = planes.map((p, c) => {
    let w = Math.ceil(dims.width / 2 ** hs[c]!);
    let hh = Math.ceil(dims.height / 2 ** vs[c]!);
    let q = crop(p, strides[c]!, w, hh);
    if (hs[c]) {
      q = crop(upsampleChroma2x(q, w, hh, true), w * 2, dims.width, hh);
      w = dims.width;
    }
    if (vs[c]) {
      q = crop(upsampleChroma2x(q, w, hh, false), w, w, dims.height);
      hh = dims.height;
    }
    return q;
  });
  const rf = fh.restorationFilter;
  if (rf.epfIters === 0) return { planes: out };
  const sigma = new Float32Array(bw * bh);
  for (let i = 0; i < sigma.length; i++) {
    sigma[i] = epfSigma(globalScale, img.qf[i]!, img.sharpness[i]!, rf.epfQuantMul, rf.epfSharpLut);
  }
  return { planes: out, sigma };
}
