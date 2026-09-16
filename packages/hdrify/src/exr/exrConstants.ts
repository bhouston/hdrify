/**
 * EXR (OpenEXR) constants
 * OpenEXR standard magic numbers, sizes, and compression types
 */

// PIZ/Huffman constants
export const USHORT_RANGE = 1 << 16;
export const BITMAP_SIZE = USHORT_RANGE >> 3;

export const HUF_ENCBITS = 16;
export const HUF_DECBITS = 14;
export const HUF_ENCSIZE = (1 << HUF_ENCBITS) + 1;
export const HUF_DECSIZE = 1 << HUF_DECBITS;
export const HUF_DECMASK = HUF_DECSIZE - 1;

export const SHORT_ZEROCODE_RUN = 59;
export const LONG_ZEROCODE_RUN = 63;
export const SHORTEST_LONG_RUN = 2 + LONG_ZEROCODE_RUN - SHORT_ZEROCODE_RUN;

// Wavelet constants
export const NBITS = 16;
export const A_OFFSET = 1 << (NBITS - 1);
export const MOD_MASK = (1 << NBITS) - 1;

// Size constants
export const ULONG_SIZE = 8;
export const FLOAT32_SIZE = 4;
export const INT32_SIZE = 4;
export const INT16_SIZE = 2;
export const INT8_SIZE = 1;

// Compression types (OpenEXR standard)
export const NO_COMPRESSION = 0;
export const RLE_COMPRESSION = 1;
export const ZIPS_COMPRESSION = 2;
export const ZIP_COMPRESSION = 3;
export const PIZ_COMPRESSION = 4;
export const PXR24_COMPRESSION = 5;
export const B44_COMPRESSION = 6;
export const B44A_COMPRESSION = 7;
export const DWAA_COMPRESSION = 8;
export const DWAB_COMPRESSION = 9;

/** EXR compression name → OpenEXR compression code. Single source of truth for all packages. */
export const EXR_COMPRESSION_CODES = {
  none: NO_COMPRESSION,
  rle: RLE_COMPRESSION,
  zips: ZIPS_COMPRESSION,
  zip: ZIP_COMPRESSION,
  piz: PIZ_COMPRESSION,
  pxr24: PXR24_COMPRESSION,
  b44: B44_COMPRESSION,
  b44a: B44A_COMPRESSION,
  dwaa: DWAA_COMPRESSION,
  dwab: DWAB_COMPRESSION,
} as const;

export type ExrCompression = keyof typeof EXR_COMPRESSION_CODES;

/** All supported EXR compression names, in OpenEXR code order. */
export const EXR_COMPRESSIONS = Object.keys(EXR_COMPRESSION_CODES) as ExrCompression[];

/** OpenEXR compression code → name */
export const EXR_COMPRESSION_NAMES: Record<number, ExrCompression> = Object.fromEntries(
  EXR_COMPRESSIONS.map((name) => [EXR_COMPRESSION_CODES[name], name]),
);

// Pixel types
export const UINT = 0;
export const HALF = 1;
export const FLOAT = 2;

// EXR magic number
export const EXR_MAGIC = 20000630;
