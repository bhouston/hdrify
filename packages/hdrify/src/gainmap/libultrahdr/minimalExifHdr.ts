/**
 * Minimal EXIF block for Ultra HDR JPEG so Apple Photos/Preview may show HDR/10-bit.
 * Contains only CustomRendered = 3 (HDR, original saved) per Apple's usage.
 * APP1 payload: "Exif\0\0" + TIFF-style IFD with Exif subIFD and tag 0xA001.
 */

const EXIF_SIGNATURE = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"

/** EXIF tag: Exif IFD pointer */
const TAG_EXIF_IFD = 0x8769;
/** EXIF tag: CustomRendered (Apple: 3 = HDR original saved) */
const TAG_CUSTOM_RENDERED = 0xa001;

const TYPE_SHORT = 3;
const TYPE_LONG = 4;

/**
 * Build minimal EXIF APP1 payload (Exif\0\0 + TIFF) with CustomRendered=3.
 * Byte order: little endian.
 */
export function buildMinimalExifHdr(): Uint8Array {
  // TIFF starts at offset 6 (after "Exif\0\0"). First IFD at offset 8.
  const tiffStart = 6;
  const ifd0Offset = 8;
  const ifd0Start = tiffStart + ifd0Offset; // 14
  const exifIfdOffset = ifd0Start + 2 + 12 + 4 - tiffStart; // 26 from TIFF start
  const exifIfdStart = tiffStart + exifIfdOffset; // 32

  const size = exifIfdStart + 2 + 12 + 4; // 50
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);

  let o = 0;
  out.set(EXIF_SIGNATURE, o);
  o += 6;
  // TIFF header (little endian)
  v.setUint16(o, 0x4949, true); // II
  o += 2;
  v.setUint16(o, 42, true);
  o += 2;
  v.setUint32(o, ifd0Offset, true);
  o += 4;
  // IFD0: one entry (Exif IFD pointer)
  v.setUint16(o, 1, true); // num entries
  o += 2;
  v.setUint16(o, TAG_EXIF_IFD, true);
  o += 2;
  v.setUint16(o, TYPE_LONG, true);
  o += 2;
  v.setUint32(o, 1, true);
  o += 4;
  v.setUint32(o, exifIfdOffset, true);
  o += 4;
  v.setUint32(o, 0, true); // next IFD
  o += 4;
  // Exif IFD: one entry (CustomRendered = 3)
  v.setUint16(o, 1, true);
  o += 2;
  v.setUint16(o, TAG_CUSTOM_RENDERED, true);
  o += 2;
  v.setUint16(o, TYPE_SHORT, true);
  o += 2;
  v.setUint32(o, 1, true);
  o += 4;
  v.setUint32(o, 3, true); // value 3 = HDR (original saved)
  o += 4;
  v.setUint32(o, 0, true);

  return out;
}

/** Cached minimal EXIF for HDR; use in Ultra HDR output. */
let cached: Uint8Array | null = null;

export function getMinimalExifHdr(): Uint8Array {
  if (!cached) cached = buildMinimalExifHdr();
  return cached;
}
