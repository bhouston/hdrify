/**
 * EXR (OpenEXR) constants
 * OpenEXR standard magic numbers, sizes, and compression types
 */
export declare const USHORT_RANGE: number;
export declare const BITMAP_SIZE: number;
export declare const HUF_ENCBITS = 16;
export declare const HUF_DECBITS = 14;
export declare const HUF_ENCSIZE: number;
export declare const HUF_DECSIZE: number;
export declare const HUF_DECMASK: number;
export declare const SHORT_ZEROCODE_RUN = 59;
export declare const LONG_ZEROCODE_RUN = 63;
export declare const SHORTEST_LONG_RUN: number;
export declare const NBITS = 16;
export declare const A_OFFSET: number;
export declare const MOD_MASK: number;
export declare const ULONG_SIZE = 8;
export declare const FLOAT32_SIZE = 4;
export declare const INT32_SIZE = 4;
export declare const INT16_SIZE = 2;
export declare const INT8_SIZE = 1;
export declare const NO_COMPRESSION = 0;
export declare const RLE_COMPRESSION = 1;
export declare const ZIPS_COMPRESSION = 2;
export declare const ZIP_COMPRESSION = 3;
export declare const PIZ_COMPRESSION = 4;
export declare const PXR24_COMPRESSION = 5;
export declare const B44_COMPRESSION = 6;
export declare const B44A_COMPRESSION = 7;
export declare const SUPPORTED_COMPRESSION: number[];
export declare const COMPRESSION_NAMES: Record<number, string>;
export declare const UINT = 0;
export declare const HALF = 1;
export declare const FLOAT = 2;
export declare const EXR_MAGIC = 20000630;
