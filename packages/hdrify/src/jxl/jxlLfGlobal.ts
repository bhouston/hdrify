/**
 * LfGlobal section (ISO/IEC 18181-1 G.1; libjxl dec_frame.cc FrameDecoder::ProcessDCGlobal):
 * patches/splines/noise, LfChannelDequantization, the VarDCT Quantizer, HfBlockContext and
 * LfChannelCorrelation bundles, then the global MA tree and the GlobalModular stream.
 */
import { type JxlBitReader, unpackSigned } from './jxlBitReader.js';
import { type JxlEntropyDecoder, readContextMap } from './jxlEntropy.js';
import {
  type JxlNoiseParams,
  type JxlPatches,
  type JxlSplines,
  readNoiseParams,
  readPatches,
  readSplines,
} from './jxlFeatures.js';
import type { JxlFrameDimensions, JxlFrameHeader } from './jxlFrameHeader.js';
import type { JxlImageHeader } from './jxlImageHeader.js';
import { type MaTree, readMaTree } from './jxlMaTree.js';
import { decodeModularStream, type ModularChannelInfo, type ModularImage } from './jxlModular.js';

/** Quantizer bundle (libjxl quantizer.cc Quantizer::Decode). */
export interface JxlQuantizer {
  globalScale: number;
  quantLf: number;
}

/** HF block context map (libjxl ac_context.h BlockCtxMap / DecodeBlockCtxMap). */
export interface JxlHfBlockContext {
  /** LF quant thresholds per channel (X, Y, B). */
  lfThresholds: [Int32Array, Int32Array, Int32Array];
  /** qf thresholds (already +1, compared with `qf > t`). */
  qfThresholds: Int32Array;
  /** Block context map, `3 * 13 * (qf + 1) * numLfCtx` entries. */
  ctxMap: Uint8Array;
  numClusters: number;
  /** Product of (lfThresholds[c].length + 1). */
  numLfCtx: number;
}

/** LfChannelCorrelation bundle (libjxl chroma_from_luma.cc ColorCorrelation::DecodeDC). */
export interface JxlLfChannelCorrelation {
  colourFactor: number;
  baseCorrelationX: number;
  baseCorrelationB: number;
  xFactorLf: number;
  bFactorLf: number;
}

export interface JxlLfGlobal {
  patches?: JxlPatches;
  splines?: JxlSplines;
  noise?: JxlNoiseParams;
  /** LfChannelDequantization m_{x,y,b}_lf (F16 values; libjxl dc_quant = m / 128). */
  mLf: [number, number, number];
  quantizer?: JxlQuantizer;
  blockCtx?: JxlHfBlockContext;
  cfl?: JxlLfChannelCorrelation;
  globalTree?: MaTree;
  globalDecoder?: JxlEntropyDecoder;
  /** GlobalModular image (transforms not undone): colour channels (Modular frames) then extra channels. */
  gmodular: ModularImage;
  /** Number of colour channels in `gmodular` before transforms (0 for VarDCT). */
  nbColor: number;
}

/** libjxl kDefaultCtxMap: default block context map (15 clusters). */
export const JXL_DEFAULT_BLOCK_CTX_MAP = new Uint8Array([
  0, 1, 2, 2, 3, 3, 4, 5, 6, 6, 6, 6, 6, 7, 8, 9, 9, 10, 11, 12, 13, 14, 14, 14, 14, 14, 7, 8, 9, 9, 10, 11, 12, 13, 14,
  14, 14, 14, 14,
]);

export function readQuantizer(br: JxlBitReader): JxlQuantizer {
  const globalScale = br.readU32(
    { bits: 11, offset: 1 },
    { bits: 11, offset: 2049 },
    { bits: 12, offset: 4097 },
    { bits: 16, offset: 8193 },
  );
  const quantLf = br.readU32(16, { bits: 5, offset: 1 }, { bits: 8, offset: 1 }, { bits: 16, offset: 1 });
  return { globalScale, quantLf };
}

export function readHfBlockContext(br: JxlBitReader): JxlHfBlockContext {
  const lfThresholds: [Int32Array, Int32Array, Int32Array] = [new Int32Array(0), new Int32Array(0), new Int32Array(0)];
  if (br.readBool()) {
    return {
      lfThresholds,
      qfThresholds: new Int32Array(0),
      ctxMap: JXL_DEFAULT_BLOCK_CTX_MAP,
      numClusters: 15,
      numLfCtx: 1,
    };
  }
  let numLfCtx = 1;
  for (let c = 0; c < 3; c++) {
    const t = new Int32Array(br.readBits(4));
    for (let i = 0; i < t.length; i++) {
      t[i] = unpackSigned(
        br.readU32({ bits: 4 }, { bits: 8, offset: 16 }, { bits: 16, offset: 272 }, { bits: 32, offset: 65808 }),
      );
    }
    lfThresholds[c] = t;
    numLfCtx *= t.length + 1;
  }
  const qfThresholds = new Int32Array(br.readBits(4));
  for (let i = 0; i < qfThresholds.length; i++) {
    qfThresholds[i] =
      1 + br.readU32({ bits: 2 }, { bits: 3, offset: 4 }, { bits: 5, offset: 12 }, { bits: 8, offset: 44 });
  }
  if (numLfCtx * (qfThresholds.length + 1) > 64) throw new Error('JXL: invalid HF block context');
  const ctxMap = readContextMap(br, 39 * numLfCtx * (qfThresholds.length + 1));
  const numClusters = Math.max(...ctxMap) + 1;
  if (numClusters > 16) throw new Error('JXL: too many HF block clusters');
  return { lfThresholds, qfThresholds, ctxMap, numClusters, numLfCtx };
}

export function readLfChannelCorrelation(br: JxlBitReader): JxlLfChannelCorrelation {
  if (br.readBool())
    return { colourFactor: 84, baseCorrelationX: 0, baseCorrelationB: 1, xFactorLf: 128, bFactorLf: 128 };
  return {
    colourFactor: br.readU32(84, 256, { bits: 8, offset: 2 }, { bits: 16, offset: 258 }),
    baseCorrelationX: br.readF16(),
    baseCorrelationB: br.readF16(),
    xFactorLf: br.readBits(8),
    bFactorLf: br.readBits(8),
  };
}

/** Read LfGlobal up to and including the GlobalModular stream. */
export function readLfGlobal(
  br: JxlBitReader,
  h: JxlImageHeader,
  fh: JxlFrameHeader,
  dims: JxlFrameDimensions,
): JxlLfGlobal {
  const patches = fh.patches ? readPatches(br, h, fh) : undefined;
  const splines = fh.splines ? readSplines(br, fh) : undefined;
  const noise = fh.noise ? readNoiseParams(br) : undefined;
  const mLf: [number, number, number] = [1 / 32, 1 / 4, 1 / 2];
  if (!br.readBool()) {
    for (let c = 0; c < 3; c++) {
      mLf[c] = br.readF16();
      if (!(mLf[c]! / 128 >= 1e-8)) throw new Error('JXL: invalid LF dequantization');
    }
  }
  const vardct = fh.encoding === 'vardct';
  const quantizer = vardct ? readQuantizer(br) : undefined;
  const blockCtx = vardct ? readHfBlockContext(br) : undefined;
  const cfl = vardct ? readLfChannelCorrelation(br) : undefined;
  // libjxl DecodeGlobalInfo: one colour channel only for gray without a colour transform (XYB/YCbCr).
  const nbChans = h.colorEncoding.colorSpace === 'gray' && !h.xybEncoded && !fh.doYCbCr ? 1 : 3;
  const treeLimit = 1024 + Math.floor((dims.width * dims.height * (nbChans + h.extraChannels.length)) / 16);
  const global = br.readBool() ? readMaTree(br, treeLimit) : undefined;

  const chans: ModularChannelInfo[] = [];
  const nbColor = vardct ? 0 : nbChans;
  // Subsampling modes encode relative JPEG sampling factors, not absolute shifts.
  const hFactors = [0, 1, 1, 0];
  const vFactors = [0, 1, 0, 1];
  for (let c = 0; c < nbColor; c++) {
    const hshift = dims.maxHShift - hFactors[fh.jpegUpsampling[c]!]!;
    const vshift = dims.maxVShift - vFactors[fh.jpegUpsampling[c]!]!;
    chans.push({
      width: Math.ceil(dims.width / 2 ** hshift),
      height: Math.ceil(dims.height / 2 ** vshift),
      hshift,
      vshift,
    });
  }
  const upShift = Math.log2(fh.upsampling);
  h.extraChannels.forEach((ec, i) => {
    const ecUp = fh.ecUpsampling[i]! << ec.dimShift;
    const s = Math.log2(ecUp) - upShift;
    chans.push({
      width: Math.ceil(dims.upsampledWidth / ecUp),
      height: Math.ceil(dims.upsampledHeight / ecUp),
      hshift: s,
      vshift: s,
    });
  });
  const gmodular = decodeModularStream(br, chans, {
    globalTree: global?.tree,
    globalDecoder: global?.decoder,
    streamId: 0,
    maxChanSize: dims.groupDim,
    bitDepth: h.bitDepth.bitsPerSample,
  });
  return {
    patches,
    splines,
    noise,
    mLf,
    quantizer,
    blockCtx,
    cfl,
    globalTree: global?.tree,
    globalDecoder: global?.decoder,
    gmodular,
    nbColor,
  };
}
