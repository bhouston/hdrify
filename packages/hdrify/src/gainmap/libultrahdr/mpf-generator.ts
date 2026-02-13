/**
 * Multi-Picture Format (MPF) generator
 * Based on CIPA DC-007 specification and libultrahdr multipictureformat.cpp
 *
 * MPF is used to embed multiple images in a single JPEG file
 */

/**
 * MPF constants from the specification
 */
const MPF_CONSTANTS = {
  /** MPF signature "MPF\0" */
  SIGNATURE: new Uint8Array([0x4d, 0x50, 0x46, 0x00]),

  /** Big endian marker "MM" */
  BIG_ENDIAN: new Uint8Array([0x4d, 0x4d]),

  /** Little endian marker "II" */
  LITTLE_ENDIAN: new Uint8Array([0x49, 0x49]),

  /** TIFF magic number */
  TIFF_MAGIC: 0x002a,

  /** Number of pictures in MPF */
  NUM_PICTURES: 2,

  /** Number of tags to serialize */
  TAG_COUNT: 3,

  /** Size of each tag in bytes */
  TAG_SIZE: 12,

  /** Size of each MP entry in bytes */
  MP_ENTRY_SIZE: 16,
} as const;

/**
 * MPF tag identifiers
 */
const MPF_TAGS = {
  /** MPF version tag */
  VERSION: 0xb000,

  /** Number of images tag */
  NUMBER_OF_IMAGES: 0xb001,

  /** MP entry tag */
  MP_ENTRY: 0xb002,
} as const;

/**
 * MPF tag types
 */
const MPF_TAG_TYPES = {
  /** Undefined type */
  UNDEFINED: 7,

  /** Unsigned long type */
  ULONG: 4,
} as const;

/**
 * MP entry attributes
 */
const MP_ENTRY_ATTRIBUTES = {
  /** JPEG format */
  FORMAT_JPEG: 0x00000000,

  /** Primary image type (Baseline MP Primary Image) */
  TYPE_PRIMARY: 0x00030000,
} as const;

/**
 * MPF version string
 */
const MPF_VERSION = new Uint8Array([0x30, 0x31, 0x30, 0x30]); // "0100"

/**
 * Calculate the total size of the MPF structure
 */
export function calculateMpfSize(): number {
  return (
    MPF_CONSTANTS.SIGNATURE.length + // Signature "MPF\0"
    2 + // Endianness marker
    2 + // TIFF magic number
    4 + // Index IFD Offset
    2 + // Tag count
    MPF_CONSTANTS.TAG_COUNT * MPF_CONSTANTS.TAG_SIZE + // Tags
    4 + // Attribute IFD offset
    MPF_CONSTANTS.NUM_PICTURES * MPF_CONSTANTS.MP_ENTRY_SIZE // MP Entries
  );
}

/**
 * Generate MPF (Multi-Picture Format) data structure
 */
export function generateMpf(
  primaryImageSize: number,
  primaryImageOffset: number,
  secondaryImageSize: number,
  secondaryImageOffset: number,
): Uint8Array {
  const mpfSize = calculateMpfSize();
  const buffer = new ArrayBuffer(mpfSize);
  const view = new DataView(buffer);
  const uint8View = new Uint8Array(buffer);

  let pos = 0;
  // Use Little Endian to match reference file
  const littleEndian = true;

  uint8View.set(MPF_CONSTANTS.SIGNATURE, pos);
  pos += MPF_CONSTANTS.SIGNATURE.length;

  // Set Little Endian marker 'II'
  uint8View.set(MPF_CONSTANTS.LITTLE_ENDIAN, pos);
  pos += 2;

  view.setUint16(pos, MPF_CONSTANTS.TIFF_MAGIC, littleEndian);
  pos += 2;

  // IFD (tag count + tags) starts at 12; offset at 8 points to it
  const indexIfdOffset = 12;
  view.setUint32(pos, indexIfdOffset, littleEndian);
  pos += 4;

  view.setUint16(pos, MPF_CONSTANTS.TAG_COUNT, littleEndian);
  pos += 2;

  view.setUint16(pos, MPF_TAGS.VERSION, littleEndian);
  pos += 2;
  view.setUint16(pos, MPF_TAG_TYPES.UNDEFINED, littleEndian);
  pos += 2;
  view.setUint32(pos, MPF_VERSION.length, littleEndian);
  pos += 4;
  uint8View.set(MPF_VERSION, pos);
  pos += 4;

  view.setUint16(pos, MPF_TAGS.NUMBER_OF_IMAGES, littleEndian);
  pos += 2;
  view.setUint16(pos, MPF_TAG_TYPES.ULONG, littleEndian);
  pos += 2;
  view.setUint32(pos, 1, littleEndian);
  pos += 4;
  view.setUint32(pos, MPF_CONSTANTS.NUM_PICTURES, littleEndian);
  pos += 4;

  view.setUint16(pos, MPF_TAGS.MP_ENTRY, littleEndian);
  pos += 2;
  view.setUint16(pos, MPF_TAG_TYPES.UNDEFINED, littleEndian);
  pos += 2;
  view.setUint32(pos, MPF_CONSTANTS.MP_ENTRY_SIZE * MPF_CONSTANTS.NUM_PICTURES, littleEndian);
  pos += 4;

  // First MP entry starts at 58 (after next-IFD 4 bytes at 54)
  const mpEntryOffset = 58;
  view.setUint32(pos, mpEntryOffset, littleEndian);
  pos += 4;

  view.setUint32(pos, 0, littleEndian);
  pos += 4;

  // Primary image entry
  view.setUint32(pos, MP_ENTRY_ATTRIBUTES.FORMAT_JPEG | MP_ENTRY_ATTRIBUTES.TYPE_PRIMARY, littleEndian);
  pos += 4;
  view.setUint32(pos, primaryImageSize, littleEndian);
  pos += 4;
  view.setUint32(pos, primaryImageOffset, littleEndian);
  pos += 4;
  view.setUint16(pos, 0, littleEndian);
  pos += 2;
  view.setUint16(pos, 0, littleEndian);
  pos += 2;

  // Secondary image entry
  view.setUint32(pos, MP_ENTRY_ATTRIBUTES.FORMAT_JPEG, littleEndian);
  pos += 4;
  view.setUint32(pos, secondaryImageSize, littleEndian);
  pos += 4;
  view.setUint32(pos, secondaryImageOffset, littleEndian);
  pos += 4;
  view.setUint16(pos, 0, littleEndian);
  pos += 2;
  view.setUint16(pos, 0, littleEndian);

  return uint8View;
}
