import type { LinearColorSpace } from '../color/colorSpaces.js';
import { sRGBToLinear } from '../color/srgb.js';
import type { HdrifyImage } from '../hdrifyImage.js';
import { JxlBitReader } from './jxlBitReader.js';
import { extractCodestream } from './jxlContainer.js';
import {
  frameDimensions,
  type JxlFrameDimensions,
  type JxlFrameHeader,
  type JxlPasses,
  readFrameHeader,
  readToc,
} from './jxlFrameHeader.js';
import { type JxlBitDepth, type JxlImageHeader, readImageHeader } from './jxlImageHeader.js';
import { drawSplines, renderNoise } from './jxlFeatures.js';
import { type JxlLfGlobal, readLfGlobal } from './jxlLfGlobal.js';
import { applyInverseTransforms, decodeModularGroup, type ModularChannel, modularStreamId } from './jxlModular.js';
import { advanceFrameIndices, upsampleFrame } from './jxlRender.js';
import { applyEpf, applyGaborish } from './jxlRestoration.js';
import { upsamplePlane } from './jxlUpsample.js';
import {
  createVardctImage,
  type JxlVardctOutput,
  readHfGlobal,
  readHfMetadata,
  readLfCoeffs,
  readPassGroup,
  reconstructVardct,
} from './jxlVardctDecode.js';
import { xybToLinearSrgb, ycbcrToRgb } from './jxlXyb.js';

/** libjxl FrameHeader::Passes::GetDownsamplingBracket: [minShift, maxShift] of channels coded in `pass`. */
export function downsamplingBracket(passes: JxlPasses, pass: number): [number, number] {
  let maxShift = 2;
  let minShift = 3;
  for (let i = 0; ; i++) {
    for (let j = 0; j < passes.numDs; j++) {
      if (i === passes.lastPass[j]) {
        const d = passes.downsample[j];
        if (d === 8) minShift = 3;
        if (d === 4) minShift = 2;
        if (d === 2) minShift = 1;
        if (d === 1) minShift = 0;
      }
    }
    if (i === passes.numPasses - 1) minShift = 0;
    if (i === pass) return [minShift, maxShift];
    maxShift = minShift - 1;
  }
}

/** A decoded frame: Modular channels (colour for Modular frames, then extra channels) and VarDCT XYB planes. */
export interface JxlDecodedFrame {
  fh: JxlFrameHeader;
  dims: JxlFrameDimensions;
  lfGlobal: JxlLfGlobal;
  /** GlobalModular channels after inverse transforms. */
  channels: ModularChannel[];
  /** VarDCT output (XYB, or RGB/YCbCr for non-XYB images), `dims.width x dims.height`. */
  vardct?: JxlVardctOutput;
  frameEnd: number;
}

/** A decoded LF frame: XYB planes at 1/8 resolution (libjxl dc_frames). */
export interface JxlLfFrame {
  planes: Float32Array[];
  width: number;
}

/**
 * Decode one frame (libjxl dec_frame.cc): LfGlobal, LfGroups (VarDCT LF, Modular LF group,
 * HfMetadata), HfGlobal, PassGroups (VarDCT HF, Modular group), then the inverse global transforms
 * and VarDCT reconstruction. `lfFrames[1]` supplies the LF image of `useLfFrame` frames.
 */
export function decodeFrame(
  codestream: Uint8Array,
  frameStart: number,
  h: JxlImageHeader,
  lfFrames: readonly (JxlLfFrame | undefined)[] = [],
): JxlDecodedFrame {
  const fbr = new JxlBitReader(codestream, frameStart);
  const fh = readFrameHeader(fbr, h);
  const toc = readToc(fbr, fh);
  const base = fbr.byteOffset;
  const dims = frameDimensions(fh);
  const vardct = fh.encoding === 'vardct';

  const section = (i: number) => new JxlBitReader(codestream, base + toc.offsets[i]!, toc.sizes[i]);
  const single = toc.sizes.length === 1;
  const lf = section(0);
  const lfg = readLfGlobal(lf, h, fh, dims);
  const img = lfg.gmodular;
  const opts = { globalTree: lfg.globalTree, globalDecoder: lfg.globalDecoder };
  const vimg = vardct ? createVardctImage(fh, dims) : undefined;
  for (let g = 0; g < dims.numLfGroups; g++) {
    const br = single ? lf : section(1 + g);
    if (vimg && !fh.useLfFrame) readLfCoeffs(br, vimg, lfg, dims, g);
    const rect = {
      x0: (g % dims.lfGroupsPerRow) * dims.lfGroupDim,
      y0: Math.floor(g / dims.lfGroupsPerRow) * dims.lfGroupDim,
      size: dims.lfGroupDim,
    };
    decodeModularGroup(br, img, rect, dims.groupDim, 3, 1000, {
      ...opts,
      streamId: modularStreamId('lfGroup', g, dims.numLfGroups),
    });
    if (vimg) readHfMetadata(br, vimg, lfg, dims, g);
  }
  const hfg = vimg ? readHfGlobal(single ? lf : section(1 + dims.numLfGroups), fh, dims, lfg) : undefined;
  for (let p = 0; p < fh.passes.numPasses; p++) {
    const [minShift, maxShift] = downsamplingBracket(fh.passes, p);
    for (let g = 0; g < dims.numGroups; g++) {
      const br = single ? lf : section(2 + dims.numLfGroups + p * dims.numGroups + g);
      if (vimg) readPassGroup(br, vimg, lfg, hfg!, fh, dims, p, g);
      const rect = {
        x0: (g % dims.groupsPerRow) * dims.groupDim,
        y0: Math.floor(g / dims.groupsPerRow) * dims.groupDim,
        size: dims.groupDim,
      };
      decodeModularGroup(br, img, rect, dims.groupDim, minShift, maxShift, {
        ...opts,
        streamId: modularStreamId('group', g, dims.numLfGroups, dims.numGroups, p),
      });
    }
  }
  applyInverseTransforms(img);
  const out = vimg ? reconstructVardct(vimg, lfg, hfg!, h, fh, dims, lfFrames[1]) : undefined;
  const frameEnd = base + toc.sizes.reduce((a, b) => a + b, 0);
  return { fh, dims, lfGlobal: lfg, channels: img.channels, vardct: out, frameEnd };
}

/**
 * Decode the Modular image of a frame. Returns integer channels. Without `allowLossy`, frames
 * needing post-processing (XYB, filters, upsampling) are rejected.
 */
export function decodeModularFrame(
  codestream: Uint8Array,
  frameStart: number,
  h: JxlImageHeader,
  { allowLossy = false } = {},
): { channels: ModularChannel[]; fh: JxlFrameHeader; frameEnd: number } {
  const fh = readFrameHeader(new JxlBitReader(codestream, frameStart), h);
  const unsupported = [
    fh.encoding !== 'modular' && 'VarDCT (lossy) frames',
    // allowLossy: decode the Modular samples only, skipping XYB/restoration post-processing (tests, tooling).
    !allowLossy && fh.upsampling !== 1 && 'frame upsampling',
    !allowLossy && h.xybEncoded && 'XYB (lossy) Modular',
    !allowLossy && fh.restorationFilter.gab && 'gaborish',
    !allowLossy && fh.restorationFilter.epfIters > 0 && 'edge-preserving filter',
  ].filter(Boolean);
  if (unsupported.length) throw new Error(`JXL: not yet supported: ${unsupported.join(', ')}`);
  const { channels, frameEnd } = decodeFrame(codestream, frameStart, h);
  return { channels, fh, frameEnd };
}

const f32 = new Float32Array(1);
const i32 = new Int32Array(f32.buffer);

/** Convert one Modular sample to a float: IEEE bit patterns for float samples, v / (2^bits − 1) for integers. */
function sampleConverter(bd: JxlBitDepth): (v: number) => number {
  if (!bd.floatSample) {
    const scale = 1 / (2 ** bd.bitsPerSample - 1);
    return (v) => v * scale;
  }
  if (bd.bitsPerSample === 32 && bd.expBits === 8) {
    return (v) => {
      i32[0] = v;
      return f32[0]!;
    };
  }
  // Generic small float (e.g. binary16, bfloat16, 24-bit): sign | exp | mantissa (libjxl dec_modular.cc).
  const mantBits = bd.bitsPerSample - bd.expBits - 1;
  const bias = 2 ** (bd.expBits - 1) - 1;
  const expMax = 2 ** bd.expBits - 1;
  return (v) => {
    const sign = (v >>> (bd.bitsPerSample - 1)) & 1 ? -1 : 1;
    const exp = Math.floor(v / 2 ** mantBits) & expMax;
    const mant = v & (2 ** mantBits - 1);
    if (exp === 0) return sign * mant * 2 ** (1 - bias - mantBits);
    if (exp === expMax) return mant ? Number.NaN : sign * Number.POSITIVE_INFINITY;
    return sign * (1 + mant / 2 ** mantBits) * 2 ** (exp - bias);
  };
}

function linearColorSpaceOf(h: JxlImageHeader): LinearColorSpace {
  const ce = h.colorEncoding;
  if (ce.wantIcc) return 'linear-rec709'; // ponytail: ICC profile not interpreted (no CMS); assumes sRGB primaries
  if (ce.colorSpace === 'gray' || ce.primaries === 'srgb') return 'linear-rec709';
  if (ce.primaries === 'p3') return 'linear-p3';
  if (ce.primaries === 'bt2100') return 'linear-rec2020';
  throw new Error('JXL: custom primaries are not supported');
}

/** Map an encoded (non-linear) value to linear light per the image's transfer function. */
function transferToLinear(h: JxlImageHeader): ((v: number) => number) | undefined {
  const ce = h.colorEncoding;
  // ponytail: ICC images assume sRGB transfer for integer samples, linear for float; add a CMS when needed.
  if (ce.wantIcc) return h.bitDepth.floatSample ? undefined : sRGBToLinear;
  switch (ce.transferFunction) {
    case 'linear':
      return undefined;
    case 'srgb':
      return sRGBToLinear;
    case 'gamma': {
      const g = 1 / ce.gamma!;
      return (v) => (v <= 0 ? 0 : v ** g);
    }
    case 'bt709':
      return (v) => (v < 0.081 ? v / 4.5 : ((v + 0.099) / 1.099) ** (1 / 0.45));
    default:
      throw new Error(`JXL: transfer function '${ce.transferFunction}' is not supported yet`);
  }
}

const upsamplingWeights = (h: JxlImageHeader, k: number) =>
  k === 2 ? h.upsampling2Weights : k === 4 ? h.upsampling4Weights : h.upsampling8Weights;

/** Float colour planes of a lossy frame (VarDCT, or XYB Modular scaled per libjxl ModularImageToDecodedRect). */
function lossyColorPlanes(fr: JxlDecodedFrame, h: JxlImageHeader): Float32Array[] | undefined {
  if (fr.vardct) return fr.vardct.planes;
  if (!h.xybEncoded) return undefined;
  // XYB Modular is coded as Y, X, B-Y; scale by LfChannelDequantization / 128.
  const y = fr.channels[0]!.data;
  const x = fr.channels[1]!.data;
  const b = fr.channels[2]!.data;
  const [mx, my, mb] = fr.lfGlobal.mLf.map((m) => m / 128);
  const n = fr.dims.width * fr.dims.height;
  const planes = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    planes[0]![i] = x[i]! * mx!;
    planes[1]![i] = y[i]! * my!;
    planes[2]![i] = (b[i]! + y[i]!) * mb!;
  }
  return planes;
}

/**
 * Colour render pipeline before the colour transform (libjxl dec_cache.cc PreparePipeline order):
 * gaborish, EPF, splines, upsampling, noise.
 */
function renderPlanes(
  fr: JxlDecodedFrame,
  h: JxlImageHeader,
  planes: Float32Array[],
  frameIdx: { visible: number; nonvisible: number },
): Float32Array[] {
  const { fh, dims, lfGlobal: lfg } = fr;
  if (lfg.patches) throw new Error('JXL: not yet supported: patches');
  const rf = fh.restorationFilter;
  const { width, height } = dims;
  if (rf.gab) {
    for (let c = 0; c < 3; c++)
      applyGaborish(planes[c]!, width, height, rf.gabWeights[2 * c]!, rf.gabWeights[2 * c + 1]!);
  }
  if (rf.epfIters > 0) {
    const sw = Math.ceil(width / 8);
    const sigma = fr.vardct?.sigma ?? new Float32Array(sw * Math.ceil(height / 8)).fill(rf.epfSigmaForModular);
    const sigmaStride = fr.vardct ? dims.xsizeBlocks : sw;
    applyEpf(planes, width, height, sigma, sigmaStride, {
      iters: rf.epfIters,
      channelScale: rf.epfChannelScale,
      pass0SigmaScale: rf.epfPass0SigmaScale,
      pass2SigmaScale: rf.epfPass2SigmaScale,
      borderSadMul: rf.epfBorderSadMul,
    });
  }
  const cfl = { yToX: lfg.cfl?.baseCorrelationX ?? 0, yToB: lfg.cfl?.baseCorrelationB ?? 1 };
  if (lfg.splines) drawSplines([planes[0]!, planes[1]!, planes[2]!], width, height, lfg.splines, cfl);
  const up = upsampleFrame(planes, fh, h, 'late');
  if (lfg.noise) {
    renderNoise([up[0]!, up[1]!, up[2]!], dims.upsampledWidth, dims.upsampledHeight, lfg.noise, {
      visibleFrameIndex: frameIdx.visible,
      nonvisibleFrameIndex: frameIdx.nonvisible,
      groupDim: dims.groupDim,
      ...cfl,
    });
  }
  return up;
}

/**
 * Read a JPEG XL file (bare codestream or ISOBMFF container) into a linear-light float RGBA image.
 * Decodes single-frame Modular (lossless and lossy XYB) and VarDCT images, including an optional
 * preceding LF frame (progressive DC). XYB images decode to linear sRGB primaries.
 */
export function readJxl(data: Uint8Array): HdrifyImage {
  const { codestream, isContainer } = extractCodestream(data);
  const br = new JxlBitReader(codestream);
  const h = readImageHeader(br);
  if (h.preview) throw new Error('JXL: preview frames are not supported yet');
  if (h.animation) throw new Error('JXL: animations are not supported');
  const lfFrames: JxlLfFrame[] = [];
  const frameIdx = { visible: 0, nonvisible: 0 };
  let pos = br.byteOffset;
  let fr: JxlDecodedFrame;
  for (;;) {
    fr = decodeFrame(codestream, pos, h, lfFrames);
    pos = fr.frameEnd;
    advanceFrameIndices(frameIdx, fr.fh);
    if (fr.fh.frameType !== 'lf') break;
    const planes = lossyColorPlanes(fr, h);
    if (!planes) throw new Error('JXL: not yet supported: non-XYB LF frames');
    lfFrames[fr.fh.lfLevel] = { planes: renderPlanes(fr, h, planes, frameIdx), width: fr.dims.upsampledWidth };
  }
  const { channels, fh } = fr;
  if (!fh.isLast || fh.frameType !== 'regular') throw new Error('JXL: multi-frame images are not supported yet');
  const { width, height } = h;
  if (fh.width !== width || fh.height !== height) throw new Error('JXL: cropped frames are not supported yet');

  const n = width * height;
  const out = new Float32Array(n * 4);
  const nbColor = fr.lfGlobal.nbColor;
  const lossy = lossyColorPlanes(fr, h);
  if (lossy) {
    const planes = renderPlanes(fr, h, lossy, frameIdx);
    const r = planes[0]!;
    const g = planes[1]!;
    const b = planes[2]!;
    if (h.xybEncoded) {
      xybToLinearSrgb(r, g, b, n, {
        inverseMatrix: h.opsinInverse.matrix,
        opsinBias: h.opsinInverse.opsinBias,
        intensityTarget: h.toneMapping.intensityTarget,
      });
    } else if (fh.doYCbCr) {
      ycbcrToRgb(r, g, b, n);
    }
    const toLinear = h.xybEncoded ? undefined : transferToLinear(h);
    for (let c = 0; c < 3; c++) {
      const p = planes[h.colorEncoding.colorSpace === 'gray' && !h.xybEncoded ? 0 : c]!;
      for (let i = 0; i < n; i++) out[i * 4 + c] = toLinear ? toLinear(p[i]!) : p[i]!;
    }
  } else {
    if (fh.upsampling !== 1 || fh.restorationFilter.gab || fh.restorationFilter.epfIters > 0) {
      throw new Error('JXL: not yet supported: restoration filters / upsampling on non-XYB Modular');
    }
    const toFloat = sampleConverter(h.bitDepth);
    const toLinear = transferToLinear(h);
    for (let c = 0; c < 3; c++) {
      const src = channels[nbColor === 1 ? 0 : c]!.data;
      for (let i = 0; i < n; i++) {
        const v = toFloat(src[i]!);
        out[i * 4 + c] = toLinear ? toLinear(v) : v;
      }
    }
  }
  const alphaIdx = h.extraChannels.findIndex((ec) => ec.type === 'alpha');
  if (alphaIdx < 0) {
    for (let i = 0; i < n; i++) out[i * 4 + 3] = 1;
  } else {
    const ec = h.extraChannels[alphaIdx]!;
    const src = channels[nbColor + alphaIdx]!;
    const toAlpha = sampleConverter(ec.bitDepth);
    let alpha = Float32Array.from(src.data, toAlpha);
    const k = fh.ecUpsampling[alphaIdx]! << ec.dimShift;
    if (k === 2 || k === 4 || k === 8) {
      // Extra-channel upsampling (libjxl UpsamplingStage with the image's kernels), cropped to the frame.
      const up = upsamplePlane(alpha, src.width, src.height, k, upsamplingWeights(h, k));
      alpha = new Float32Array(n);
      for (let y = 0; y < height; y++) alpha.set(up.subarray(y * src.width * k, y * src.width * k + width), y * width);
    }
    if (alpha.length !== n) throw new Error('JXL: extra channel size mismatch');
    for (let i = 0; i < n; i++) out[i * 4 + 3] = alpha[i]!;
  }

  return {
    width,
    height,
    data: out,
    linearColorSpace: h.xybEncoded ? 'linear-rec709' : linearColorSpaceOf(h),
    metadata: {
      format: 'JPEG XL',
      container: isContainer,
      encoding: fh.encoding,
      bitsPerSample: h.bitDepth.bitsPerSample,
      floatSample: h.bitDepth.floatSample,
      colorSpace: h.colorEncoding.colorSpace,
      transferFunction: h.colorEncoding.transferFunction,
      orientation: h.orientation,
      intensityTarget: h.toneMapping.intensityTarget,
      extraChannels: h.extraChannels.map((ec) => ec.name || ec.type),
      ...(h.icc && { iccProfile: h.icc }),
    },
  };
}
