import { convertOutputColor, jxlColorMetadata, xybFromLinear } from './jxlColor.js';
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
import { applyPatches, drawSplines, renderNoise } from './jxlFeatures.js';
import { type JxlLfGlobal, readLfGlobal } from './jxlLfGlobal.js';
import { applyInverseTransforms, decodeModularGroup, type ModularChannel, modularStreamId } from './jxlModular.js';
import {
  advanceFrameIndices,
  blendFrame,
  isDisplayedFrame,
  type JxlReferenceFrame,
  staysLinear,
  saveReference,
  upsampleFrame,
} from './jxlRender.js';
import { applyEpf, applyGaborish } from './jxlRestoration.js';
import {
  createVardctImage,
  type JxlVardctOutput,
  readHfGlobal,
  readHfMetadata,
  readLfCoeffs,
  readPassGroup,
  reconstructVardct,
  upsampleChroma2x,
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
  const out = vimg ? reconstructVardct(vimg, lfg, hfg!, h, fh, dims, lfFrames[fh.lfLevel + 1]) : undefined;
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

/** Float planes of a frame at coded resolution: 3 colour planes (gray copied to all 3), then extra channels. */
function framePlanes(fr: JxlDecodedFrame, h: JxlImageHeader): Float32Array[] {
  const nbColor = fr.lfGlobal.nbColor;
  let color = lossyColorPlanes(fr, h);
  if (!color) {
    const toFloat = sampleConverter(h.bitDepth);
    color = [0, 1, 2].map((c) => {
      const channel = fr.channels[nbColor === 1 ? 0 : c]!;
      let p: Float32Array = Float32Array.from(channel.data, toFloat);
      let { width, height } = channel;
      if (channel.hshift) {
        p = upsampleChroma2x(p, width, height, true);
        width *= 2;
      }
      if (channel.vshift) {
        p = upsampleChroma2x(p, width, height, false);
        height *= 2;
      }
      if (width === fr.dims.width && height === fr.dims.height) return p;
      const cropped = new Float32Array(fr.dims.width * fr.dims.height);
      for (let y = 0; y < fr.dims.height; y++)
        cropped.set(p.subarray(y * width, y * width + fr.dims.width), y * fr.dims.width);
      return cropped;
    });
  }
  const ecs = h.extraChannels.map((ec, i) =>
    Float32Array.from(fr.channels[nbColor + i]!.data, sampleConverter(ec.bitDepth)),
  );
  return [...color, ...ecs];
}

/**
 * Render pipeline before the colour transform (libjxl dec_cache.cc PreparePipeline order): gaborish,
 * EPF, early (extra channel) upsampling, patches, splines, late upsampling, noise.
 */
function renderFrame(
  fr: JxlDecodedFrame,
  h: JxlImageHeader,
  frameIdx: { visible: number; nonvisible: number },
  references: readonly (JxlReferenceFrame | undefined)[],
): Float32Array[] {
  const { fh, dims, lfGlobal: lfg } = fr;
  const rf = fh.restorationFilter;
  const { width, height } = dims;
  let planes = framePlanes(fr, h);
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
  planes = upsampleFrame(planes, fh, h, 'early');
  if (lfg.patches) applyPatches(planes, width, height, lfg.patches, references, h.extraChannels);
  const cfl = { yToX: lfg.cfl?.baseCorrelationX ?? 0, yToB: lfg.cfl?.baseCorrelationB ?? 1 };
  if (lfg.splines) drawSplines([planes[0]!, planes[1]!, planes[2]!], width, height, lfg.splines, cfl);
  planes = upsampleFrame(planes, fh, h, 'late');
  if (lfg.noise) {
    renderNoise([planes[0]!, planes[1]!, planes[2]!], dims.upsampledWidth, dims.upsampledHeight, lfg.noise, {
      visibleFrameIndex: frameIdx.visible,
      nonvisibleFrameIndex: frameIdx.nonvisible,
      groupDim: dims.groupDim,
      ...cfl,
    });
  }
  return planes;
}

/** Skip one frame: returns its header and the byte offset after it. */
function skipFrame(
  codestream: Uint8Array,
  pos: number,
  h: JxlImageHeader,
  isPreview = false,
): { fh: JxlFrameHeader; end: number } {
  const br = new JxlBitReader(codestream, pos);
  const fh = readFrameHeader(br, h, isPreview);
  const toc = readToc(br, fh);
  const end = br.byteOffset + toc.sizes.reduce((a, b) => a + b, 0);
  if (end > codestream.length) throw new Error('JXL: truncated frame sections');
  return { fh, end };
}

/** A displayed (coalesced) frame: image-sized planes in the image's encoded colour space unless `linear`. */
export interface JxlDisplayedFrame {
  canvas: JxlReferenceFrame;
  fh: JxlFrameHeader;
  /** Planes are linear light (an XYB frame that was neither blended nor referenced). */
  linear: boolean;
  /** Byte offset after the frame. */
  end: number;
}

/**
 * Decode frames from `start` (libjxl dec_frame.cc / decode.cc order) and yield each displayed frame
 * composited onto the canvas: LF frames, reference slots, patches, blending and cropped frames.
 */
export function* decodeDisplayedFrames(
  codestream: Uint8Array,
  h: JxlImageHeader,
  start: number,
): Generator<JxlDisplayedFrame, void> {
  const lfFrames: JxlLfFrame[] = [];
  const references: (JxlReferenceFrame | undefined)[] = [];
  const frameIdx = { visible: 0, nonvisible: 0 };
  let pos = start;
  for (;;) {
    const fr = decodeFrame(codestream, pos, h, lfFrames);
    pos = fr.frameEnd;
    const { fh } = fr;
    advanceFrameIndices(frameIdx, fh);
    const planes = renderFrame(fr, h, frameIdx, references);
    const { upsampledWidth: w, upsampledHeight: hh } = fr.dims;
    if (fh.frameType === 'lf') {
      lfFrames[fh.lfLevel] = { planes, width: w };
      continue;
    }
    const frame: JxlReferenceFrame = { width: w, height: hh, planes };
    const beforeCt = fh.saveBeforeCt ? { ...frame, planes: planes.map((p, c) => (c < 3 ? p.slice() : p)) } : frame;
    let linear = staysLinear(fh);
    const [r, g, b] = [planes[0]!, planes[1]!, planes[2]!];
    const n = w * hh;
    if (h.xybEncoded) {
      xybToLinearSrgb(r, g, b, n, {
        inverseMatrix: h.opsinInverse.matrix,
        opsinBias: h.opsinInverse.opsinBias,
        intensityTarget: h.toneMapping.intensityTarget,
      });
      if (!linear) xybFromLinear(h, planes);
    } else {
      linear = false;
      if (fh.doYCbCr) ycbcrToRgb(r, g, b, n);
      if (fr.vardct && h.colorEncoding.colorSpace === 'gray') {
        g.set(r);
        b.set(r);
      }
    }
    const canvas = blendFrame(frame, fh, h, references);
    saveReference(references, fh, beforeCt, canvas);
    if (isDisplayedFrame(fh)) yield { canvas, fh, linear, end: pos };
    if (fh.isLast) return;
  }
}

/** Options shared by still and animation decoding. */
export interface ReadJxlOptions {
  /** Apply the stored EXIF orientation to pixels and extra channels (default true). */
  applyOrientation?: boolean;
  /** Preserve associated alpha instead of returning straight alpha (default false). */
  keepPremultipliedAlpha?: boolean;
  /** Composite spot-colour channels onto RGB (default false: expose the planes only). */
  renderSpotColors?: boolean;
}

/** A full-resolution extra channel in the same orientation as the returned image. */
export interface JxlExtraChannel {
  name: string;
  type: JxlImageHeader['extraChannels'][number]['type'];
  width: number;
  height: number;
  data: Float32Array;
  /** Spot RGB and solidity as stored in the codestream. */
  spotColor?: [number, number, number, number];
  /** CFA channel index, when present. */
  cfaChannel?: number;
}

export interface JxlAnimationFrame {
  image: HdrifyImage;
  /** Frame duration in seconds. Still images have duration zero. */
  duration: number;
  /** Original 32-bit animation timecode, when present. */
  timecode?: number;
}

function openJxl(data: Uint8Array) {
  const { codestream, isContainer } = extractCodestream(data);
  const br = new JxlBitReader(codestream);
  const h = readImageHeader(br);
  // A preview is an independent frame and must not populate references or advance noise counters.
  const start = h.preview ? skipFrame(codestream, br.byteOffset, h, true).end : br.byteOffset;
  return { codestream, isContainer, h, start };
}

/** Apply EXIF orientation to row-major interleaved samples without mutating the source. */
function orient(
  data: Float32Array,
  width: number,
  height: number,
  channels: number,
  orientation: number,
): Float32Array {
  if (orientation === 1) return data;
  const out = new Float32Array(data.length);
  const outWidth = orientation >= 5 ? height : width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tx =
        orientation === 2 || orientation === 3
          ? width - 1 - x
          : orientation === 5 || orientation === 8
            ? y
            : orientation === 6 || orientation === 7
              ? height - 1 - y
              : x;
      const ty =
        orientation === 3 || orientation === 4
          ? height - 1 - y
          : orientation === 5 || orientation === 6
            ? x
            : orientation === 7 || orientation === 8
              ? width - 1 - x
              : y;
      const from = (y * width + x) * channels;
      out.set(data.subarray(from, from + channels), (ty * outWidth + tx) * channels);
    }
  }
  return out;
}

function displayedImage(
  first: JxlDisplayedFrame,
  h: JxlImageHeader,
  isContainer: boolean,
  options: ReadJxlOptions,
): HdrifyImage {
  const { canvas, fh } = first;
  const { width, height } = h;
  if (canvas.width !== width || canvas.height !== height) throw new Error('JXL: displayed frame is not image-sized');
  const n = width * height;
  const out = new Float32Array(n * 4);
  const spots = options.renderSpotColors
    ? h.extraChannels.flatMap((ec, i) => (ec.spotColor ? [{ color: ec.spotColor, plane: canvas.planes[3 + i]! }] : []))
    : [];
  for (let c = 0; c < 3; c++) {
    const p = canvas.planes[c]!;
    for (let i = 0; i < n; i++) {
      // libjxl stage_spot runs after coalescing/reference storage and before output colour conversion.
      let value = p[i]!;
      for (const spot of spots) {
        const mix = spot.color[3] * spot.plane[i]!;
        value = mix * spot.color[c]! + (1 - mix) * value;
      }
      out[i * 4 + c] = value;
    }
  }
  const linearColorSpace = convertOutputColor(h, out, first.linear);
  const alphaIdx = h.extraChannels.findIndex((ec) => ec.type === 'alpha');
  const alpha = alphaIdx < 0 ? undefined : canvas.planes[3 + alphaIdx];
  const associated = alphaIdx >= 0 && h.extraChannels[alphaIdx]!.alphaAssociated;
  for (let i = 0; i < n; i++) {
    const a = alpha ? alpha[i]! : 1;
    out[i * 4 + 3] = a;
    if (associated && !options.keepPremultipliedAlpha) {
      // Match libjxl kSmallAlpha, including tiny/zero alpha without NaN/Inf.
      const scale = 1 / Math.max(a, 2 ** -26);
      for (let c = 0; c < 3; c++) out[i * 4 + c] = out[i * 4 + c]! * scale;
    }
  }
  const orientation = options.applyOrientation === false ? 1 : h.orientation;
  const outWidth = orientation >= 5 ? height : width;
  const outHeight = orientation >= 5 ? width : height;
  const extraChannels: JxlExtraChannel[] = h.extraChannels.map((ec, i) => ({
    name: ec.name || ec.type,
    type: ec.type,
    width: outWidth,
    height: outHeight,
    data: orient(canvas.planes[3 + i]!.slice(), width, height, 1, orientation),
    ...(ec.spotColor && { spotColor: [...ec.spotColor] as [number, number, number, number] }),
    ...(ec.cfaChannel !== undefined && { cfaChannel: ec.cfaChannel }),
  }));
  return {
    width: outWidth,
    height: outHeight,
    data: orient(out, width, height, 4, orientation),
    linearColorSpace,
    metadata: {
      format: 'JPEG XL',
      container: isContainer,
      encoding: fh.encoding,
      bitsPerSample: h.bitDepth.bitsPerSample,
      floatSample: h.bitDepth.floatSample,
      colorSpace: h.colorEncoding.colorSpace,
      transferFunction: h.colorEncoding.transferFunction,
      orientation: h.orientation,
      ...jxlColorMetadata(h),
      intensityTarget: h.toneMapping.intensityTarget,
      alphaPremultiplied: associated && !!options.keepPremultipliedAlpha,
      extraChannels,
      ...(h.icc && { iccProfile: h.icc }),
    },
  };
}

/**
 * Decode every coalesced displayed frame into linear-light RGBA, with duration in seconds.
 * Each frame owns its pixel/extra-channel buffers. This eager API retains the complete animation.
 */
export function readJxlFrames(
  data: Uint8Array,
  options: ReadJxlOptions = {},
): { frames: JxlAnimationFrame[]; numLoops: number } {
  const { codestream, isContainer, h, start } = openJxl(data);
  const frames: JxlAnimationFrame[] = [];
  for (const frame of decodeDisplayedFrames(codestream, h, start)) {
    frames.push({
      image: displayedImage(frame, h, isContainer, options),
      duration: h.animation ? (frame.fh.duration * h.animation.tpsDenominator) / h.animation.tpsNumerator : 0,
      ...(h.animation?.haveTimecodes && { timecode: frame.fh.timecode }),
    });
  }
  if (!frames.length) throw new Error('JXL: no displayed frame');
  return { frames, numLoops: h.animation?.numLoops ?? 0 };
}

/**
 * Read a JPEG XL codestream or container into linear-light RGBA, applying orientation and returning
 * straight alpha by default. Animations return the first displayed frame; use readJxlFrames for all.
 * PQ uses 1.0 = the header intensityTarget in nits, matching djxl float linear output.
 * HLG returns display light after libjxl's RGB-dependent intensity-target OOTF.
 * Custom primaries and non-D65 white points are Bradford-adapted to linear Rec.2020.
 * RGB matrix/TRC and recognized HDR cICP ICC profiles are managed; unsupported LUT/CMYK profiles
 * use the historical sRGB fallback and metadata.iccColorManaged = false. originalChromaticities is
 * supplied for enum/custom encodings; embedded ICC sources retain metadata.iccProfile instead.
 * XYB frames used for composition or references are converted to the original primaries/transfer
 * encoding before blending. The coalesced canvas is linearized for public output.
 * Extra channel samples are retained in metadata.extraChannels. CMYK ICC conversion is unsupported.
 */
export function readJxl(data: Uint8Array, options: ReadJxlOptions = {}): HdrifyImage {
  const { codestream, isContainer, h, start } = openJxl(data);
  const first = decodeDisplayedFrames(codestream, h, start).next().value;
  if (!first) throw new Error('JXL: no displayed frame');
  const image = displayedImage(first, h, isContainer, options);
  if (h.animation) {
    const ticks = [first.fh.duration];
    let pos = first.end;
    for (let f = first.fh; !f.isLast;) {
      ({ fh: f, end: pos } = skipFrame(codestream, pos, h));
      if (isDisplayedFrame(f)) ticks.push(f.duration);
    }
    image.metadata!.animation = {
      frameCount: ticks.length,
      frameDurations: ticks.map((t) => (t * h.animation!.tpsDenominator) / h.animation!.tpsNumerator),
      numLoops: h.animation.numLoops,
    };
  }
  return image;
}
