/**
 * JPEG XL frame header, restoration filter params and TOC (ISO/IEC 18181-1, sections 9.2, C.4 / F.1).
 * Reference: libjxl lib/jxl/frame_header.{h,cc}, loop_filter.cc, frame_dimensions.h, toc.cc;
 * jxl-oxide crates/jxl-frame/src/header.rs.
 */
import { type JxlBitReader, unpackSigned } from './jxlBitReader.js';
import { JxlEntropyDecoder, readPermutation } from './jxlEntropy.js';
import { type JxlImageHeader, readName, skipExtensions } from './jxlImageHeader.js';

export type JxlFrameType = 'regular' | 'lf' | 'referenceOnly' | 'skipProgressive';
export type JxlBlendMode = 'replace' | 'add' | 'blend' | 'mulAdd' | 'mul';

export interface JxlBlendingInfo {
  mode: JxlBlendMode;
  alphaChannel: number;
  clamp: boolean;
  source: number;
}

export interface JxlPasses {
  numPasses: number;
  numDs: number;
  /** Per-pass coefficient shift; length numPasses (the last is always 0). */
  shift: number[];
  downsample: number[];
  lastPass: number[];
}

/** LoopFilter bundle (libjxl loop_filter.h); defaults match libjxl. */
export interface JxlRestorationFilter {
  gab: boolean;
  gabCustom: boolean;
  /** [x1, x2, y1, y2, b1, b2] Gaborish weights. */
  gabWeights: number[];
  epfIters: number;
  epfSharpCustom: boolean;
  /** 8-entry sharpness LUT. */
  epfSharpLut: number[];
  epfWeightCustom: boolean;
  epfChannelScale: [number, number, number];
  epfPass1Zeroflush: number;
  epfPass2Zeroflush: number;
  epfSigmaCustom: boolean;
  epfQuantMul: number;
  epfPass0SigmaScale: number;
  epfPass2SigmaScale: number;
  epfBorderSadMul: number;
  epfSigmaForModular: number;
}

export interface JxlFrameHeader {
  frameType: JxlFrameType;
  encoding: 'vardct' | 'modular';
  /** Raw flags U64. */
  flags: number;
  noise: boolean;
  patches: boolean;
  splines: boolean;
  useLfFrame: boolean;
  skipAdaptiveLfSmoothing: boolean;
  doYCbCr: boolean;
  /** Per-channel (Cb, Y, Cr order as coded) chroma subsampling mode 0..3. */
  jpegUpsampling: [number, number, number];
  upsampling: number;
  /** Coded ec_upsampling per extra channel (effective factor is `ecUpsampling[i] << dimShift`). */
  ecUpsampling: number[];
  groupSizeShift: number;
  xQmScale: number;
  bQmScale: number;
  passes: JxlPasses;
  lfLevel: number;
  haveCrop: boolean;
  x0: number;
  y0: number;
  /** Frame size in image pixels (crop size, or the image/preview size). */
  width: number;
  height: number;
  blendingInfo: JxlBlendingInfo;
  ecBlendingInfo: JxlBlendingInfo[];
  duration: number;
  timecode: number;
  isLast: boolean;
  saveAsReference: number;
  saveBeforeCt: boolean;
  name: string;
  restorationFilter: JxlRestorationFilter;
}

const FLAG_NOISE = 0x1;
const FLAG_PATCHES = 0x2;
const FLAG_SPLINES = 0x10;
const FLAG_USE_LF_FRAME = 0x20;
const FLAG_SKIP_ADAPTIVE_LF_SMOOTHING = 0x80;

const hasFlag = (flags: number, bit: number) => Math.floor(flags / bit) % 2 === 1;
const FRAME_TYPES: JxlFrameType[] = ['regular', 'lf', 'referenceOnly', 'skipProgressive'];
const BLEND_MODES: JxlBlendMode[] = ['replace', 'add', 'blend', 'mulAdd', 'mul'];
const U32_1248 = [1, 2, 4, 8] as const;
const readU1248 = (br: JxlBitReader) => br.readU32(...U32_1248);

/** libjxl LoopFilter defaults. */
export function defaultRestorationFilter(): JxlRestorationFilter {
  const w1 = 1.1 * 0.104699568;
  const w2 = 1.1 * 0.055680538;
  return {
    gab: true,
    gabCustom: false,
    gabWeights: [w1, w2, w1, w2, w1, w2],
    epfIters: 2,
    epfSharpCustom: false,
    epfSharpLut: Array.from({ length: 8 }, (_, i) => i / 7),
    epfWeightCustom: false,
    epfChannelScale: [40, 5, 3.5],
    epfPass1Zeroflush: 0.45,
    epfPass2Zeroflush: 0.6,
    epfSigmaCustom: false,
    epfQuantMul: 0.46,
    epfPass0SigmaScale: 0.9,
    epfPass2SigmaScale: 6.5,
    epfBorderSadMul: 2 / 3,
    epfSigmaForModular: 1,
  };
}

/** LoopFilter::VisitFields. */
function readRestorationFilter(br: JxlBitReader, isModular: boolean): JxlRestorationFilter {
  const rf = defaultRestorationFilter();
  if (br.readBool()) return rf;
  rf.gab = br.readBool();
  if (rf.gab) {
    rf.gabCustom = br.readBool();
    if (rf.gabCustom) {
      rf.gabWeights = Array.from({ length: 6 }, () => br.readF16());
      for (let c = 0; c < 3; c++) {
        if (Math.abs(1 + (rf.gabWeights[2 * c]! + rf.gabWeights[2 * c + 1]!) * 4) < 1e-8) {
          throw new Error('JXL: degenerate Gaborish weights');
        }
      }
    }
  }
  rf.epfIters = br.readBits(2);
  if (rf.epfIters > 0) {
    if (!isModular) {
      rf.epfSharpCustom = br.readBool();
      if (rf.epfSharpCustom) rf.epfSharpLut = Array.from({ length: 8 }, () => br.readF16());
    }
    rf.epfWeightCustom = br.readBool();
    if (rf.epfWeightCustom) {
      rf.epfChannelScale = [br.readF16(), br.readF16(), br.readF16()];
      rf.epfPass1Zeroflush = br.readF16();
      rf.epfPass2Zeroflush = br.readF16();
    }
    rf.epfSigmaCustom = br.readBool();
    if (rf.epfSigmaCustom) {
      if (!isModular) rf.epfQuantMul = br.readF16();
      rf.epfPass0SigmaScale = br.readF16();
      rf.epfPass2SigmaScale = br.readF16();
      rf.epfBorderSadMul = br.readF16();
    }
    if (isModular) {
      rf.epfSigmaForModular = br.readF16();
      if (rf.epfSigmaForModular < 1e-8) throw new Error('JXL: EPF sigma for modular too small');
    }
  }
  skipExtensions(br);
  return rf;
}

/** BlendingInfo::VisitFields. */
function readBlendingInfo(br: JxlBitReader, numExtra: number, isPartial: boolean): JxlBlendingInfo {
  const modeId = br.readU32(0, 1, 2, { bits: 2, offset: 3 });
  const mode = BLEND_MODES[modeId];
  if (!mode) throw new Error(`JXL: invalid blend mode ${modeId}`);
  const usesAlpha = numExtra > 0 && (mode === 'blend' || mode === 'mulAdd');
  const bi: JxlBlendingInfo = { mode, alphaChannel: 0, clamp: false, source: 0 };
  if (usesAlpha) {
    bi.alphaChannel = br.readU32(0, 1, 2, { bits: 3, offset: 3 });
    if (bi.alphaChannel >= numExtra) throw new Error('JXL: invalid blending alpha channel');
  }
  if (usesAlpha || mode === 'mul') bi.clamp = br.readBool();
  if (mode !== 'replace' || isPartial) bi.source = br.readBits(2);
  return bi;
}

/** Passes::VisitFields. */
function readPasses(br: JxlBitReader): JxlPasses {
  const numPasses = br.readU32(1, 2, 3, { bits: 3, offset: 4 });
  const p: JxlPasses = {
    numPasses,
    numDs: 0,
    shift: Array.from({ length: numPasses }, () => 0),
    downsample: [],
    lastPass: [],
  };
  if (numPasses === 1) return p;
  p.numDs = br.readU32(0, 1, 2, { bits: 1, offset: 3 });
  if (p.numDs > numPasses) throw new Error('JXL: num_ds > num_passes');
  for (let i = 0; i < numPasses - 1; i++) p.shift[i] = br.readBits(2);
  for (let i = 0; i < p.numDs; i++) p.downsample.push(readU1248(br));
  for (let i = 0; i < p.numDs; i++) p.lastPass.push(br.readU32(0, 1, 2, { bits: 3 }));
  for (let i = 1; i < p.numDs; i++) {
    if (p.downsample[i]! >= p.downsample[i - 1]! || p.lastPass[i]! <= p.lastPass[i - 1]!) {
      throw new Error('JXL: invalid pass downsampling');
    }
  }
  if (p.lastPass.some((v) => v >= numPasses)) throw new Error('JXL: last_pass >= num_passes');
  return p;
}

/**
 * Read a FrameHeader (FrameHeader::VisitFields). The reader must be at the frame's byte-aligned start.
 * `isPreview` selects the preview size as the default frame size.
 */
export function readFrameHeader(br: JxlBitReader, image: JxlImageHeader, isPreview = false): JxlFrameHeader {
  const numExtra = image.extraChannels.length;
  const defaultSize = isPreview && image.preview ? image.preview : image;
  const fh: JxlFrameHeader = {
    frameType: 'regular',
    encoding: 'vardct',
    flags: 0,
    noise: false,
    patches: false,
    splines: false,
    useLfFrame: false,
    skipAdaptiveLfSmoothing: false,
    doYCbCr: false,
    jpegUpsampling: [0, 0, 0],
    upsampling: 1,
    ecUpsampling: Array.from({ length: numExtra }, () => 1),
    groupSizeShift: 1,
    xQmScale: image.xybEncoded ? 3 : 2,
    bQmScale: 2,
    passes: { numPasses: 1, numDs: 0, shift: [0], downsample: [], lastPass: [] },
    lfLevel: 0,
    haveCrop: false,
    x0: 0,
    y0: 0,
    width: defaultSize.width,
    height: defaultSize.height,
    blendingInfo: { mode: 'replace', alphaChannel: 0, clamp: false, source: 0 },
    ecBlendingInfo: Array.from({ length: numExtra }, () => ({
      mode: 'replace',
      alphaChannel: 0,
      clamp: false,
      source: 0,
    })),
    duration: 0,
    timecode: 0,
    isLast: true,
    saveAsReference: 0,
    saveBeforeCt: false,
    name: '',
    restorationFilter: defaultRestorationFilter(),
  };
  if (br.readBool()) return fh; // all_default

  fh.frameType = FRAME_TYPES[br.readBits(2)]!;
  if (isPreview && fh.frameType !== 'regular') throw new Error('JXL: preview must be a regular frame');
  fh.encoding = br.readBool() ? 'modular' : 'vardct';
  fh.flags = br.readU64();
  fh.noise = hasFlag(fh.flags, FLAG_NOISE);
  fh.patches = hasFlag(fh.flags, FLAG_PATCHES);
  fh.splines = hasFlag(fh.flags, FLAG_SPLINES);
  fh.useLfFrame = hasFlag(fh.flags, FLAG_USE_LF_FRAME);
  fh.skipAdaptiveLfSmoothing = hasFlag(fh.flags, FLAG_SKIP_ADAPTIVE_LF_SMOOTHING);

  if (!image.xybEncoded) fh.doYCbCr = br.readBool();
  if (fh.doYCbCr && !fh.useLfFrame) fh.jpegUpsampling = [br.readBits(2), br.readBits(2), br.readBits(2)];
  if (!fh.useLfFrame) {
    fh.upsampling = readU1248(br);
    for (let i = 0; i < numExtra; i++) {
      const up = readU1248(br);
      const effective = up << image.extraChannels[i]!.dimShift;
      if (effective < fh.upsampling || effective > 8) throw new Error('JXL: invalid extra channel upsampling');
      fh.ecUpsampling[i] = up;
    }
  }
  if (fh.encoding === 'modular') fh.groupSizeShift = br.readBits(2);
  if (fh.encoding === 'vardct' && image.xybEncoded) {
    fh.xQmScale = br.readBits(3);
    fh.bQmScale = br.readBits(3);
  } else {
    fh.xQmScale = fh.bQmScale = 2;
  }
  if (fh.frameType !== 'referenceOnly') fh.passes = readPasses(br);
  if (fh.frameType === 'lf') fh.lfLevel = br.readU32(1, 2, 3, 4);

  const normal = fh.frameType === 'regular' || fh.frameType === 'skipProgressive';
  let isPartial = false;
  if (fh.frameType !== 'lf') {
    fh.haveCrop = br.readBool();
    if (fh.haveCrop) {
      const crop = () =>
        br.readU32({ bits: 8 }, { bits: 11, offset: 256 }, { bits: 14, offset: 2304 }, { bits: 30, offset: 18688 });
      if (normal) {
        fh.x0 = unpackSigned(crop());
        fh.y0 = unpackSigned(crop());
      }
      fh.width = crop();
      fh.height = crop();
      if (fh.width === 0 || fh.height === 0) throw new Error('JXL: zero-sized frame crop');
      if (normal) {
        isPartial =
          fh.x0 > 0 || fh.y0 > 0 || fh.width + fh.x0 < defaultSize.width || fh.height + fh.y0 < defaultSize.height;
      }
    }
  }

  if (normal) {
    fh.blendingInfo = readBlendingInfo(br, numExtra, isPartial);
    for (let i = 0; i < numExtra; i++) fh.ecBlendingInfo[i] = readBlendingInfo(br, numExtra, isPartial);
    if (image.animation) {
      fh.duration = br.readU32(0, 1, { bits: 8 }, { bits: 32 });
      if (image.animation.haveTimecodes) fh.timecode = br.readBits(32);
    }
    fh.isLast = br.readBool();
  } else {
    fh.isLast = false;
  }

  if (fh.frameType !== 'lf' && !fh.isLast) fh.saveAsReference = br.readBits(2);

  if (fh.frameType === 'lf') {
    fh.saveBeforeCt = true;
  } else {
    const canBeReferenced = !fh.isLast && (fh.duration === 0 || fh.saveAsReference !== 0);
    if (canBeReferenced && fh.blendingInfo.mode === 'replace' && !isPartial && normal) fh.saveBeforeCt = br.readBool();
    else if (fh.frameType === 'referenceOnly') fh.saveBeforeCt = br.readBool();
  }

  fh.name = readName(br);
  fh.restorationFilter = readRestorationFilter(br, fh.encoding === 'modular');
  skipExtensions(br);
  return fh;
}

export interface JxlRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Derived frame geometry (libjxl FrameDimensions::Set). Sizes are in coded (pre-upsampling) samples. */
export interface JxlFrameDimensions {
  /** Frame size before upsampling (after LF-level downscaling). */
  width: number;
  height: number;
  /** Frame size after upsampling. */
  upsampledWidth: number;
  upsampledHeight: number;
  xsizeBlocks: number;
  ysizeBlocks: number;
  groupDim: number;
  lfGroupDim: number;
  groupsPerRow: number;
  groupRows: number;
  lfGroupsPerRow: number;
  lfGroupRows: number;
  numGroups: number;
  numLfGroups: number;
  maxHShift: number;
  maxVShift: number;
}

const H_SHIFT = [0, 1, 1, 0];
const V_SHIFT = [0, 1, 0, 1];

export function frameDimensions(fh: JxlFrameHeader): JxlFrameDimensions {
  const lfDiv = 1 << (3 * fh.lfLevel);
  const upsampledWidth = Math.ceil(fh.width / lfDiv);
  const upsampledHeight = Math.ceil(fh.height / lfDiv);
  const width = Math.ceil(upsampledWidth / fh.upsampling);
  const height = Math.ceil(upsampledHeight / fh.upsampling);
  const maxHShift = Math.max(...fh.jpegUpsampling.map((m) => H_SHIFT[m]!));
  const maxVShift = Math.max(...fh.jpegUpsampling.map((m) => V_SHIFT[m]!));
  const xsizeBlocks = Math.ceil(width / (8 << maxHShift)) << maxHShift;
  const ysizeBlocks = Math.ceil(height / (8 << maxVShift)) << maxVShift;
  const groupDim = 128 << fh.groupSizeShift;
  const groupsPerRow = Math.ceil(width / groupDim);
  const groupRows = Math.ceil(height / groupDim);
  const lfGroupsPerRow = Math.ceil(xsizeBlocks / groupDim);
  const lfGroupRows = Math.ceil(ysizeBlocks / groupDim);
  return {
    width,
    height,
    upsampledWidth,
    upsampledHeight,
    xsizeBlocks,
    ysizeBlocks,
    groupDim,
    lfGroupDim: groupDim * 8,
    groupsPerRow,
    groupRows,
    lfGroupsPerRow,
    lfGroupRows,
    numGroups: groupsPerRow * groupRows,
    numLfGroups: lfGroupsPerRow * lfGroupRows,
    maxHShift,
    maxVShift,
  };
}

function rectIn(idx: number, perRow: number, dim: number, width: number, height: number): JxlRect {
  const x = (idx % perRow) * dim;
  const y = Math.floor(idx / perRow) * dim;
  return { x, y, width: Math.min(dim, width - x), height: Math.min(dim, height - y) };
}

/** Pixel rect of pass group `idx` (FrameDimensions::GroupRect). */
export function groupRect(d: JxlFrameDimensions, idx: number): JxlRect {
  return rectIn(idx, d.groupsPerRow, d.groupDim, d.width, d.height);
}

/** Pixel rect of LF group `idx` (FrameDimensions::DCGroupRect scaled to pixels). */
export function lfGroupRect(d: JxlFrameDimensions, idx: number): JxlRect {
  return rectIn(idx, d.lfGroupsPerRow, d.lfGroupDim, d.width, d.height);
}

export interface JxlToc {
  /** Section sizes in bytes, in logical order (LfGlobal, LfGroups, HfGlobal, PassGroups). */
  sizes: number[];
  /** Byte offsets of each logical section relative to the end of the TOC. */
  offsets: number[];
  /** Present if the TOC was permuted: logical section i is stored at original TOC index permutation[i]. */
  permutation?: number[];
}

/** Number of TOC entries: 1 for single-group single-pass frames, else 2 + numLfGroups + numGroups * numPasses. */
export function tocEntryCount(fh: JxlFrameHeader): number {
  const d = frameDimensions(fh);
  const numPasses = fh.passes.numPasses;
  return d.numGroups === 1 && numPasses === 1 ? 1 : 2 + d.numLfGroups + d.numGroups * numPasses;
}

/** Read the TOC (libjxl toc.cc ReadGroupOffsets); leaves the reader byte-aligned at the first section. */
export function readToc(br: JxlBitReader, fh: JxlFrameHeader): JxlToc {
  const n = tocEntryCount(fh);
  if (n > 65536) throw new Error('JXL: too many TOC entries');
  let permutation: number[] | undefined;
  if (br.readBool()) {
    const dec = JxlEntropyDecoder.read(br, 8);
    permutation = readPermutation(br, dec, n, 0);
    dec.finish();
  }
  br.zeroPadToByte();
  const raw: number[] = [];
  for (let i = 0; i < n; i++) {
    raw.push(
      br.readU32({ bits: 10 }, { bits: 14, offset: 1024 }, { bits: 22, offset: 17408 }, { bits: 30, offset: 4211712 }),
    );
  }
  br.zeroPadToByte();
  const rawOffsets: number[] = [];
  let off = 0;
  for (const s of raw) {
    rawOffsets.push(off);
    off += s;
  }
  if (!permutation) return { sizes: raw, offsets: rawOffsets };
  return { sizes: permutation.map((i) => raw[i]!), offsets: permutation.map((i) => rawOffsets[i]!), permutation };
}
