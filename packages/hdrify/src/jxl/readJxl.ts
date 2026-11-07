import type { LinearColorSpace } from '../color/colorSpaces.js';
import { sRGBToLinear } from '../color/srgb.js';
import type { HdrifyImage } from '../hdrifyImage.js';
import { JxlBitReader } from './jxlBitReader.js';
import { extractCodestream } from './jxlContainer.js';
import { frameDimensions, type JxlFrameHeader, type JxlPasses, readFrameHeader, readToc } from './jxlFrameHeader.js';
import { type JxlBitDepth, type JxlImageHeader, readImageHeader } from './jxlImageHeader.js';
import { readMaTree } from './jxlMaTree.js';
import {
  applyInverseTransforms,
  decodeModularGroup,
  decodeModularStream,
  type ModularChannel,
  modularStreamId,
} from './jxlModular.js';

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

/**
 * Decode the Modular image of a frame (libjxl dec_modular.cc): GlobalModular in LfGlobal, then the
 * LfGroup and PassGroup sections, then the inverse global transforms. Returns integer channels.
 */
export function decodeModularFrame(
  codestream: Uint8Array,
  frameStart: number,
  h: JxlImageHeader,
  { allowLossy = false } = {},
): { channels: ModularChannel[]; fh: JxlFrameHeader; frameEnd: number } {
  const fbr = new JxlBitReader(codestream, frameStart);
  const fh = readFrameHeader(fbr, h);
  const toc = readToc(fbr, fh);
  const base = fbr.byteOffset;
  const dims = frameDimensions(fh);
  const unsupported = [
    fh.encoding !== 'modular' && 'VarDCT (lossy) frames',
    fh.patches && 'patches',
    fh.splines && 'splines',
    fh.noise && 'noise',
    // allowLossy: decode the Modular samples only, skipping XYB/restoration post-processing (tests, tooling).
    !allowLossy && fh.upsampling !== 1 && 'frame upsampling',
    !allowLossy && h.xybEncoded && 'XYB (lossy) Modular',
    !allowLossy && fh.restorationFilter.gab && 'gaborish',
    !allowLossy && fh.restorationFilter.epfIters > 0 && 'edge-preserving filter',
  ].filter(Boolean);
  if (unsupported.length) throw new Error(`JXL: not yet supported: ${unsupported.join(', ')}`);

  const section = (i: number) => new JxlBitReader(codestream, base + toc.offsets[i]!, toc.sizes[i]);
  const lf = section(0);
  if (!lf.readBool()) for (let i = 0; i < 3; i++) lf.readF16(); // LfChannelDequantization (unused when lossless)
  const global = lf.readBool() ? readMaTree(lf) : undefined;
  const nbColor = h.colorEncoding.colorSpace === 'gray' && !fh.doYCbCr ? 1 : 3;
  const chans = [];
  for (let c = 0; c < nbColor; c++) chans.push({ width: dims.width, height: dims.height, hshift: 0, vshift: 0 });
  for (const ec of h.extraChannels) {
    const s = ec.dimShift;
    chans.push({
      width: Math.ceil(dims.width / 2 ** s),
      height: Math.ceil(dims.height / 2 ** s),
      hshift: s,
      vshift: s,
    });
  }
  const opts = { globalTree: global?.tree, globalDecoder: global?.decoder };
  const img = decodeModularStream(lf, chans, {
    ...opts,
    streamId: 0,
    maxChanSize: dims.groupDim,
    bitDepth: h.bitDepth.bitsPerSample,
  });
  if (toc.sizes.length > 1) {
    for (let g = 0; g < dims.numLfGroups; g++) {
      const rect = {
        x0: (g % dims.lfGroupsPerRow) * dims.lfGroupDim,
        y0: Math.floor(g / dims.lfGroupsPerRow) * dims.lfGroupDim,
        size: dims.lfGroupDim,
      };
      decodeModularGroup(section(1 + g), img, rect, dims.groupDim, 3, 1000, {
        ...opts,
        streamId: modularStreamId('lfGroup', g, dims.numLfGroups),
      });
    }
    for (let p = 0; p < fh.passes.numPasses; p++) {
      const [minShift, maxShift] = downsamplingBracket(fh.passes, p);
      for (let g = 0; g < dims.numGroups; g++) {
        const rect = {
          x0: (g % dims.groupsPerRow) * dims.groupDim,
          y0: Math.floor(g / dims.groupsPerRow) * dims.groupDim,
          size: dims.groupDim,
        };
        const idx = 2 + dims.numLfGroups + p * dims.numGroups + g;
        decodeModularGroup(section(idx), img, rect, dims.groupDim, minShift, maxShift, {
          ...opts,
          streamId: modularStreamId('group', g, dims.numLfGroups, dims.numGroups, p),
        });
      }
    }
  }
  applyInverseTransforms(img);
  const frameEnd = base + toc.sizes.reduce((a, b) => a + b, 0);
  return { channels: img.channels, fh, frameEnd };
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

/**
 * Read a JPEG XL file (bare codestream or ISOBMFF container) into a linear-light float RGBA image.
 * Currently decodes single-frame Modular images (lossless JPEG XL: 8/16-bit integer, float16, float32,
 * grayscale, alpha); lossy VarDCT/XYB frames throw "not yet supported".
 */
export function readJxl(data: Uint8Array): HdrifyImage {
  const { codestream, isContainer } = extractCodestream(data);
  const br = new JxlBitReader(codestream);
  const h = readImageHeader(br);
  if (h.preview) throw new Error('JXL: preview frames are not supported yet');
  if (h.animation) throw new Error('JXL: animations are not supported');
  const { channels, fh } = decodeModularFrame(codestream, br.byteOffset, h);
  if (!fh.isLast || fh.frameType !== 'regular') throw new Error('JXL: multi-frame images are not supported yet');
  const { width, height } = h;
  if (fh.width !== width || fh.height !== height) throw new Error('JXL: cropped frames are not supported yet');

  const nbColor = channels.length - h.extraChannels.length;
  const toFloat = sampleConverter(h.bitDepth);
  const toLinear = transferToLinear(h);
  const out = new Float32Array(width * height * 4);
  for (let c = 0; c < 3; c++) {
    const src = channels[nbColor === 1 ? 0 : c]!.data;
    for (let i = 0; i < width * height; i++) {
      const v = toFloat(src[i]!);
      out[i * 4 + c] = toLinear ? toLinear(v) : v;
    }
  }
  const alphaIdx = h.extraChannels.findIndex((ec) => ec.type === 'alpha');
  if (alphaIdx < 0) {
    for (let i = 0; i < width * height; i++) out[i * 4 + 3] = 1;
  } else {
    const ec = h.extraChannels[alphaIdx]!;
    if (ec.dimShift !== 0) throw new Error('JXL: subsampled alpha is not supported yet');
    const src = channels[nbColor + alphaIdx]!.data;
    const toAlpha = sampleConverter(ec.bitDepth);
    for (let i = 0; i < width * height; i++) out[i * 4 + 3] = toAlpha(src[i]!);
  }

  return {
    width,
    height,
    data: out,
    linearColorSpace: linearColorSpaceOf(h),
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
