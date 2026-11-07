/**
 * Multi-frame composition for JPEG XL (ISO/IEC 18181-1 F.2 / K): blending, reference-frame slots,
 * frame upsampling and which frames are displayed. Pure functions over float planes.
 * Reference: libjxl lib/jxl/blending.cc, alpha.cc, render_pipeline/stage_blending.cc,
 * dec_cache.cc (PassesDecoderState::PreparePipeline), dec_frame.cc, decode.cc.
 */
import type { JxlBlendMode, JxlFrameHeader } from './jxlFrameHeader.js';
import { frameDimensions } from './jxlFrameHeader.js';
import type { JxlExtraChannelInfo, JxlImageHeader } from './jxlImageHeader.js';
import { upsamplePlane } from './jxlUpsample.js';

/** A frame-sized (or image-sized) set of planes: 3 color planes then one per extra channel, row-major. */
export interface JxlReferenceFrame {
  width: number;
  height: number;
  planes: Float32Array[];
  /** Saved before the color transform (libjxl ib_is_in_xyb): usable by patches, not as a blend background. */
  savedBeforeCt?: boolean;
}

/** libjxl PatchBlendMode values (also used for frame blending, see blendFrame). */
export const PATCH_NONE = 0;
export const PATCH_REPLACE = 1;
export const PATCH_ADD = 2;
export const PATCH_MUL = 3;
export const PATCH_BLEND_ABOVE = 4;
export const PATCH_BLEND_BELOW = 5;
export const PATCH_ALPHA_WEIGHTED_ADD_ABOVE = 6;
export const PATCH_ALPHA_WEIGHTED_ADD_BELOW = 7;

export interface JxlPatchBlending {
  mode: number;
  alphaChannel: number;
  clamp: boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * libjxl PerformBlending over `n` pixels: channel c of the result is written to out[c][outOff + x] from
 * bg[c][bgOff + x] and fg[c][fgOff + x]. `blending` is [color, ...extra channels]. `out` may alias bg or fg
 * (each pixel is computed into `tmp`, length >= planes, before being stored).
 */
export function blendPixels(
  bg: readonly Float32Array[],
  bgOff: number,
  fg: readonly Float32Array[],
  fgOff: number,
  out: readonly Float32Array[],
  outOff: number,
  n: number,
  blending: readonly JxlPatchBlending[],
  ecInfo: readonly JxlExtraChannelInfo[],
  tmp: Float32Array,
): void {
  const numEc = ecInfo.length;
  const hasAlpha = ecInfo.some((ec) => ec.type === 'alpha');
  const color = blending[0]!;
  const ca = 3 + color.alphaChannel;
  const premulColor = ecInfo[color.alphaChannel]?.alphaAssociated ?? false;
  for (let x = 0; x < n; x++) {
    const b = bgOff + x;
    const f = fgOff + x;
    // Extra channels first, so that colour blending sees the pre-blending alpha.
    for (let i = 0; i < numEc; i++) {
      const { mode, alphaChannel: a, clamp } = blending[1 + i]!;
      const c = 3 + i;
      const bv = bg[c]![b]!;
      const fv = fg[c]![f]!;
      let v: number;
      if (mode === PATCH_ADD) v = bv + fv;
      else if (mode === PATCH_BLEND_ABOVE || mode === PATCH_BLEND_BELOW) {
        const above = mode === PATCH_BLEND_ABOVE;
        const botV = above ? bv : fv;
        const topV = above ? fv : bv;
        const botA = above ? bg[3 + a]![b]! : fg[3 + a]![f]!;
        const topA0 = above ? fg[3 + a]![f]! : bg[3 + a]![b]!;
        const fa = clamp ? clamp01(topA0) : topA0;
        if (i === a) v = 1 - (1 - fa) * (1 - botA);
        else if (ecInfo[a]!.alphaAssociated) v = topV + botV * (1 - fa);
        else {
          const na = 1 - (1 - fa) * (1 - botA);
          v = (topV * fa + botV * botA * (1 - fa)) * (na > 0 ? 1 / na : 0);
        }
      } else if (mode === PATCH_ALPHA_WEIGHTED_ADD_ABOVE || mode === PATCH_ALPHA_WEIGHTED_ADD_BELOW) {
        const above = mode === PATCH_ALPHA_WEIGHTED_ADD_ABOVE;
        const botV = above ? bv : fv;
        const topV = above ? fv : bv;
        const ta = above ? fg[3 + a]![f]! : bg[3 + a]![b]!;
        v = i === a ? botV : botV + topV * (clamp ? clamp01(ta) : ta);
      } else if (mode === PATCH_MUL) v = bv * (clamp ? clamp01(fv) : fv);
      else if (mode === PATCH_REPLACE) v = fv;
      else v = bv;
      tmp[c] = v;
    }
    const mode = color.mode;
    if (
      mode === PATCH_ADD ||
      (!hasAlpha && (mode === PATCH_ALPHA_WEIGHTED_ADD_ABOVE || mode === PATCH_ALPHA_WEIGHTED_ADD_BELOW))
    ) {
      for (let c = 0; c < 3; c++) tmp[c] = bg[c]![b]! + fg[c]![f]!;
    } else if (mode === PATCH_ALPHA_WEIGHTED_ADD_ABOVE || mode === PATCH_ALPHA_WEIGHTED_ADD_BELOW) {
      const above = mode === PATCH_ALPHA_WEIGHTED_ADD_ABOVE;
      const ta = above ? fg[ca]![f]! : bg[ca]![b]!;
      const w = color.clamp ? clamp01(ta) : ta;
      for (let c = 0; c < 3; c++) tmp[c] = above ? bg[c]![b]! + fg[c]![f]! * w : fg[c]![f]! + bg[c]![b]! * w;
    } else if (hasAlpha && (mode === PATCH_BLEND_ABOVE || mode === PATCH_BLEND_BELOW)) {
      const above = mode === PATCH_BLEND_ABOVE;
      const botA = above ? bg[ca]![b]! : fg[ca]![f]!;
      const topA = above ? fg[ca]![f]! : bg[ca]![b]!;
      const fa = color.clamp ? clamp01(topA) : topA;
      const na = 1 - (1 - fa) * (1 - botA);
      const rna = na > 0 ? 1 / na : 0;
      for (let c = 0; c < 3; c++) {
        const botV = above ? bg[c]![b]! : fg[c]![f]!;
        const topV = above ? fg[c]![f]! : bg[c]![b]!;
        tmp[c] = premulColor ? topV + botV * (1 - fa) : (topV * fa + botV * botA * (1 - fa)) * rna;
      }
      tmp[ca] = na;
    } else if (mode === PATCH_MUL) {
      for (let c = 0; c < 3; c++) {
        const fv = fg[c]![f]!;
        tmp[c] = bg[c]![b]! * (color.clamp ? clamp01(fv) : fv);
      }
    } else if (mode === PATCH_NONE) {
      for (let c = 0; c < 3; c++) tmp[c] = bg[c]![b]!;
    } else {
      // kReplace, and kBlend{Above,Below} without an alpha channel.
      for (let c = 0; c < 3; c++) tmp[c] = fg[c]![f]!;
    }
    for (let c = 0; c < 3 + numEc; c++) out[c]![outOff + x] = tmp[c]!;
  }
}

const FRAME_TO_PATCH_MODE: Record<JxlBlendMode, number> = {
  replace: PATCH_REPLACE,
  add: PATCH_ADD,
  blend: PATCH_BLEND_ABOVE,
  mulAdd: PATCH_ALPHA_WEIGHTED_ADD_ABOVE,
  mul: PATCH_MUL,
};

const isNormalFrame = (fh: JxlFrameHeader) => fh.frameType === 'regular' || fh.frameType === 'skipProgressive';

/** libjxl NeedsBlending: a regular frame that is cropped or not a plain replace. */
export function needsBlending(fh: JxlFrameHeader): boolean {
  if (!isNormalFrame(fh)) return false;
  return fh.haveCrop || fh.blendingInfo.mode !== 'replace' || fh.ecBlendingInfo.some((b) => b.mode !== 'replace');
}

/**
 * Compose a decoded frame onto its blending backgrounds (libjxl BlendingStage), returning the image-sized
 * canvas. `frame` is frame-sized (fh.width x fh.height, after upsampling and the color transform, in the
 * image's encoded color space). Pixels outside the frame come from the background; empty slots are black.
 * Returns `frame` itself when no blending is needed.
 */
export function blendFrame(
  frame: JxlReferenceFrame,
  fh: JxlFrameHeader,
  image: JxlImageHeader,
  references: readonly (JxlReferenceFrame | undefined)[],
): JxlReferenceFrame {
  if (!needsBlending(fh)) return frame;
  const { width, height } = image;
  const ecInfo = image.extraChannels;
  const n = width * height;
  let zeros: Float32Array | undefined;
  const background = (source: number, c: number): Float32Array => {
    const ref = references[source];
    if (!ref || ref.width === 0) return (zeros ??= new Float32Array(n));
    if (ref.savedBeforeCt) throw new Error('JXL: cannot blend onto a reference frame saved before color transform');
    if (ref.width !== width || ref.height !== height) throw new Error('JXL: blending background is not image-sized');
    return ref.planes[c]!;
  };
  const bg = [0, 1, 2].map((c) => background(fh.blendingInfo.source, c));
  for (let i = 0; i < ecInfo.length; i++) bg.push(background(fh.ecBlendingInfo[i]!.source, 3 + i));
  const out = bg.map((p) => p.slice());
  const blending = [fh.blendingInfo, ...fh.ecBlendingInfo].map((bi) => ({
    mode: FRAME_TO_PATCH_MODE[bi.mode],
    alphaChannel: bi.alphaChannel,
    clamp: bi.clamp,
  }));
  const tmp = new Float32Array(out.length);
  const xStart = Math.max(0, -fh.x0);
  const xEnd = Math.min(frame.width, width - fh.x0);
  for (let y = 0; y < (xEnd > xStart ? frame.height : 0); y++) {
    const by = fh.y0 + y;
    if (by < 0 || by >= height) continue;
    const off = by * width + fh.x0 + xStart;
    blendPixels(bg, off, frame.planes, y * frame.width + xStart, out, off, xEnd - xStart, blending, ecInfo, tmp);
  }
  return { width, height, planes: out };
}

/** libjxl FrameHeader::CanBeReferenced: saved into slot fh.saveAsReference after decoding. */
export function canBeReferenced(fh: JxlFrameHeader): boolean {
  return !fh.isLast && fh.frameType !== 'lf' && (fh.duration === 0 || fh.saveAsReference !== 0);
}

/**
 * Store a decoded frame into its reference slot (libjxl FrameDecoder::FinalizeFrame). With saveBeforeCt the
 * frame-sized planes from before the color transform are copied (`beforeCt`, after upsampling and noise);
 * otherwise the blended canvas returned by blendFrame is stored.
 */
export function saveReference(
  references: (JxlReferenceFrame | undefined)[],
  fh: JxlFrameHeader,
  beforeCt: JxlReferenceFrame,
  canvas: JxlReferenceFrame,
): void {
  if (!canBeReferenced(fh)) return;
  references[fh.saveAsReference] = fh.saveBeforeCt
    ? {
        width: beforeCt.width,
        height: beforeCt.height,
        planes: beforeCt.planes.map((p) => p.slice()),
        savedBeforeCt: true,
      }
    : canvas;
}

/** Whether a coalesced decoder outputs the canvas after this frame (decode.cc is_last_of_still). */
export function isDisplayedFrame(fh: JxlFrameHeader): boolean {
  return isNormalFrame(fh) && (fh.isLast || fh.duration > 0);
}

/** Noise RNG frame counters (dec_frame.cc InitFrame); call once per non-preview frame before rendering it. */
export function advanceFrameIndices(idx: { visible: number; nonvisible: number }, fh: JxlFrameHeader): void {
  if (isDisplayedFrame(fh)) {
    idx.visible++;
    idx.nonvisible = 0;
  } else {
    idx.nonvisible++;
  }
}

function upsampleCropped(
  plane: Float32Array,
  w: number,
  h: number,
  k: number,
  image: JxlImageHeader,
  outW: number,
  outH: number,
): Float32Array {
  if (k === 1) return plane;
  if (k !== 2 && k !== 4 && k !== 8) throw new Error(`JXL: invalid upsampling ${k}`);
  const weights = k === 2 ? image.upsampling2Weights : k === 4 ? image.upsampling4Weights : image.upsampling8Weights;
  const up = upsamplePlane(plane, w, h, k, weights);
  if (w * k === outW && h * k === outH) return up;
  const out = new Float32Array(outW * outH);
  for (let y = 0; y < outH; y++) out.set(up.subarray(y * w * k, y * w * k + outW), y * outW);
  return out;
}

/**
 * Frame upsampling stages in libjxl pipeline order (PreparePipeline). Call with phase 'early' after
 * restoration filters and before patches/splines, then 'late' after them and before noise.
 * Input sizes: color planes are frameDimensions(fh).width x height; extra channel i is
 * ceil(upsampledWidth / f) x ceil(upsampledHeight / f) with f = ecUpsampling[i] << dimShift.
 * 'early' upsamples the extra channels to the upsampled frame size unless every f equals fh.upsampling
 * (then they stay at the color resolution until 'late'); 'late' upsamples color (and those deferred
 * extra channels). After 'late' every plane is upsampledWidth x upsampledHeight. Returns new plane list.
 */
export function upsampleFrame(
  planes: readonly Float32Array[],
  fh: JxlFrameHeader,
  image: JxlImageHeader,
  phase: 'early' | 'late',
): Float32Array[] {
  const d = frameDimensions(fh);
  const ecFactors = image.extraChannels.map((ec, i) => fh.ecUpsampling[i]! << ec.dimShift);
  const lateEc = fh.upsampling !== 1 && ecFactors.every((f) => f === fh.upsampling);
  return planes.map((p, c) => {
    const f = c < 3 ? fh.upsampling : ecFactors[c - 3]!;
    if ((phase === 'late') !== (c < 3 || lateEc)) return p;
    const w = Math.ceil(d.upsampledWidth / f);
    const h = Math.ceil(d.upsampledHeight / f);
    return upsampleCropped(p, w, h, f, image, d.upsampledWidth, d.upsampledHeight);
  });
}
