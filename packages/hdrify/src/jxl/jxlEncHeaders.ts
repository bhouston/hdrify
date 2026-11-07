import type { LinearColorSpace } from '../color/colorSpaces.js';
import type { JxlBitWriter } from './jxlBitWriter.js';

/**
 * Codestream header writers for a lossless Modular JPEG XL image: SizeHeader,
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

/**
 * ImageMetadata + default CustomTransformData, then byte alignment (no ICC, no preview).
 * Colour encoding: RGB, D65, `colorSpace` primaries, linear transfer, relative intent.
 */
export function writeImageMetadata(
  w: JxlBitWriter,
  bitDepth: JxlEncBitDepth,
  hasAlpha: boolean,
  colorSpace: LinearColorSpace,
): void {
  w.writeBool(false); // all_default
  w.writeBool(false); // extra_fields
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
  w.writeBool(false); // xyb_encoded
  // ColourEncoding
  w.writeBool(false); // all_default
  w.writeBool(false); // want_icc
  w.writeEnum(0); // colour_space = kRGB
  w.writeEnum(1); // white_point = kD65
  w.writeEnum(PRIMARIES[colorSpace]);
  w.writeBool(false); // have_gamma
  w.writeEnum(8); // transfer_function = kLinear
  w.writeEnum(1); // rendering_intent = kRelative
  w.writeU64(0); // extensions
  w.writeBool(true); // CustomTransformData.all_default
  w.zeroPadToByte();
}

/** FrameHeader of the single (last, regular) lossless Modular frame. */
export function writeFrameHeader(w: JxlBitWriter, hasAlpha: boolean, groupSizeShift: number): void {
  w.writeBool(false); // all_default
  w.writeBits(2, 0); // frame_type = kRegularFrame
  w.writeBits(1, 1); // encoding = kModular
  w.writeU64(0); // flags
  w.writeBool(false); // do_YCbCr
  w.writeU32(1, 1, 2, 4, 8); // upsampling
  if (hasAlpha) w.writeU32(1, 1, 2, 4, 8); // ec_upsampling
  w.writeBits(2, groupSizeShift);
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
