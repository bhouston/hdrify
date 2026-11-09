import { encodeFloat16 } from '../exr/halfFloat.js';
import type { HdrifyImage } from '../hdrifyImage.js';
import { writeJxlIcc } from './jxlEncIcc.js';
import type { LinearColorSpace } from '../color/colorSpaces.js';
import type { JxlBitWriter } from './jxlBitWriter.js';

/**
 * Codestream header writers for Modular and VarDCT JPEG XL images: SizeHeader,
 * ImageMetadata (linear colour encoding, optional alpha), FrameHeader and TOC.
 * Field order follows libjxl headers.cc / image_metadata.cc / frame_header.cc / toc.cc
 * (the same layout as the hand-written headers in enc_fast_lossless.cc).
 */

/** Sample representation: IEEE float bit patterns or unsigned integers. */
export interface JxlEncBitDepth {
  float: boolean;
  bitsPerSample: number;
  /** Exponent bits (float only). */
  expBits: number;
}

const DIM: [
  { bits: number; offset: number },
  { bits: number; offset: number },
  { bits: number; offset: number },
  { bits: number; offset: number },
] = [
  { bits: 9, offset: 1 },
  { bits: 13, offset: 1 },
  { bits: 18, offset: 1 },
  { bits: 30, offset: 1 },
];

/** SizeHeader (never the `small` form, no aspect ratio shortcut). */
export function writeSizeHeader(w: JxlBitWriter, width: number, height: number): void {
  w.writeBool(false); // small
  w.writeU32(height, ...DIM);
  w.writeBits(3, 0); // ratio: width coded explicitly
  w.writeU32(width, ...DIM);
}

/** BitDepth bundle. */
export function writeBitDepth(w: JxlBitWriter, d: JxlEncBitDepth): void {
  w.writeBool(d.float);
  if (d.float) {
    w.writeU32(d.bitsPerSample, 32, 16, 24, { bits: 6, offset: 1 });
    w.writeBits(4, d.expBits - 1);
  } else {
    w.writeU32(d.bitsPerSample, 8, 10, 12, { bits: 6, offset: 1 });
  }
}

/** Primaries enum values from the spec (kSRGB = 1, k2100 = 9, kP3 = 11). */
const PRIMARIES: Record<LinearColorSpace, number> = {
  'linear-rec709': 1,
  'linear-p3': 11,
  'linear-rec2020': 9,
};

/** Transfer functions the encoder can write, with their ColourEncoding enum values. */
export const JXL_ENC_TRANSFERS = { linear: 8, srgb: 13, pq: 16, hlg: 18 } as const;
export type JxlEncTransfer = keyof typeof JXL_ENC_TRANSFERS;

/**
 * ToneMapping.intensity_target for an image: `metadata.linearReferenceWhiteNits` (as reported by readJxl),
 * else the JPEG XL default of 255 nits. Throws unless it is a positive finite F16 value.
 */
export function jxlIntensityTarget(image: HdrifyImage): number {
  const nits = image.metadata?.linearReferenceWhiteNits;
  if (nits === undefined) return 255;
  if (typeof nits !== 'number' || !(nits > 0 && nits <= 65504))
    throw new Error(`writeJxl: metadata.linearReferenceWhiteNits must be in (0, 65504], got ${JSON.stringify(nits)}`);
  return nits;
}

/**
 * ImageMetadata + default CustomTransformData, optional ICC, then byte alignment (no preview).
 * Colour encoding: RGB, D65, `colorSpace` primaries, `transfer` (default linear), relative intent.
 * A non-default `intensityTarget` (nits) is written in the ToneMapping bundle via extra_fields.
 */
export function writeImageMetadata(
  w: JxlBitWriter,
  bitDepth: JxlEncBitDepth,
  hasAlpha: boolean,
  colorSpace: LinearColorSpace,
  xybEncoded = false,
  iccProfile?: Uint8Array,
  intensityTarget = 255,
  transfer: JxlEncTransfer = 'linear',
): void {
  const extraFields = intensityTarget !== 255;
  w.writeBool(false); // all_default
  w.writeBool(extraFields);
  if (extraFields) {
    w.writeBits(3, 0); // orientation - 1
    w.writeBool(false); // have_intrinsic_size
    w.writeBool(false); // have_preview
    w.writeBool(false); // have_animation
  }
  writeBitDepth(w, bitDepth);
  w.writeBool(bitDepth.bitsPerSample <= 12); // modular_16_bit_buffer_sufficient
  w.writeU32(hasAlpha ? 1 : 0, 0, 1, { bits: 4, offset: 2 }, { bits: 12, offset: 1 }); // num_extra_channels
  if (hasAlpha) {
    w.writeBool(false); // ExtraChannelInfo.all_default
    w.writeEnum(0); // type = kAlpha
    writeBitDepth(w, bitDepth);
    w.writeU32(0, 0, 3, 4, { bits: 3, offset: 1 }); // dim_shift
    w.writeU32(0, 0, { bits: 4, offset: 0 }, { bits: 5, offset: 16 }, { bits: 10, offset: 48 }); // name_len
    w.writeBool(false); // alpha_associated
  }
  w.writeBool(xybEncoded); // xyb_encoded
  // ColourEncoding
  w.writeBool(false); // all_default
  w.writeBool(!!iccProfile); // want_icc
  w.writeEnum(0); // colour_space = kRGB
  if (!iccProfile) {
    w.writeEnum(1); // white_point = kD65
    w.writeEnum(PRIMARIES[colorSpace]);
    w.writeBool(false); // have_gamma
    w.writeEnum(JXL_ENC_TRANSFERS[transfer]); // transfer_function
    w.writeEnum(1); // rendering_intent = kRelative
  }
  if (extraFields) {
    w.writeBool(false); // ToneMapping.all_default
    w.writeBits(16, encodeFloat16(intensityTarget)); // intensity_target
    w.writeBits(16, 0); // min_nits
    w.writeBool(false); // relative_to_max_display
    w.writeBits(16, 0); // linear_below
  }
  w.writeU64(0); // extensions
  w.writeBool(true); // CustomTransformData.all_default
  if (iccProfile) writeJxlIcc(w, iccProfile);
  w.zeroPadToByte();
}

/** FrameHeader of a single last, regular Modular or XYB VarDCT frame. */
export function writeFrameHeader(w: JxlBitWriter, hasAlpha: boolean, groupSizeShift: number, vardct = false): void {
  w.writeBool(false); // all_default
  w.writeBits(2, 0); // frame_type = kRegularFrame
  w.writeBool(!vardct); // encoding
  w.writeU64(vardct ? 0x80 : 0); // skip adaptive LF smoothing for VarDCT
  if (!vardct) w.writeBool(false); // do_YCbCr (implicit false for XYB)
  w.writeU32(1, 1, 2, 4, 8); // upsampling
  if (hasAlpha) w.writeU32(1, 1, 2, 4, 8); // ec_upsampling
  if (vardct) {
    w.writeBits(3, 3); // x_qm_scale
    w.writeBits(3, 2); // b_qm_scale
  } else w.writeBits(2, groupSizeShift);
  w.writeU32(1, 1, 2, 3, { bits: 3, offset: 4 }); // num_passes
  w.writeBool(false); // custom_size_or_origin
  w.writeU32(0, 0, 1, 2, { bits: 2, offset: 3 }); // blending mode = kReplace
  if (hasAlpha) w.writeU32(0, 0, 1, 2, { bits: 2, offset: 3 }); // ec blending mode
  w.writeBool(true); // is_last
  w.writeU32(0, 0, { bits: 4, offset: 0 }, { bits: 5, offset: 16 }, { bits: 10, offset: 48 }); // name_len
  // RestorationFilter: Gaborish and EPF off (their defaults are on).
  w.writeBool(false); // all_default
  w.writeBool(false); // gab
  w.writeBits(2, 0); // epf_iters
  w.writeU64(0); // extensions
  w.writeU64(0); // FrameHeader extensions
}

/** TOC (unpermuted) of byte-aligned section sizes. */
export function writeToc(w: JxlBitWriter, sectionSizes: readonly number[]): void {
  w.writeBool(false); // permuted
  w.zeroPadToByte();
  for (const size of sectionSizes) {
    w.writeU32(
      size,
      { bits: 10, offset: 0 },
      { bits: 14, offset: 1024 },
      { bits: 22, offset: 17408 },
      { bits: 30, offset: 4211712 },
    );
  }
  w.zeroPadToByte();
}

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

/** Wrap a bare codestream in the ISOBMFF container: `JXL ` signature, `ftyp`, `jxlc`. */
export function wrapJxlContainer(codestream: Uint8Array): Uint8Array {
  const signature = box('JXL ', new Uint8Array([0x0d, 0x0a, 0x87, 0x0a]));
  const ftyp = box('ftyp', new Uint8Array([0x6a, 0x78, 0x6c, 0x20, 0, 0, 0, 0, 0x6a, 0x78, 0x6c, 0x20]));
  const jxlc = box('jxlc', codestream);
  const out = new Uint8Array(signature.length + ftyp.length + jxlc.length);
  out.set(signature, 0);
  out.set(ftyp, signature.length);
  out.set(jxlc, signature.length + ftyp.length);
  return out;
}
