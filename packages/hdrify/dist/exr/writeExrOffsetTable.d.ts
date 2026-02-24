/**
 * EXR scan line offset table builder
 * Builds the offset table (one 64-bit offset per block) per OpenEXR spec.
 */
/**
 * Get the number of scan lines per block for the given compression type.
 */
export declare function getBlockHeight(compression: number): number;
/**
 * Get the number of blocks for the given image height and compression.
 */
export declare function getBlockCount(height: number, compression: number): number;
export interface BuildExrOffsetTableOptions {
    width: number;
    height: number;
    compression: number;
    /** Byte offset in the file where the offset table starts */
    offsetTableStart: number;
    /** Bytes per pixel (e.g. 16 for RGBA float) */
    bytesPerPixel?: number;
}
/**
 * Build the scan line offset table.
 * Returns a Uint8Array of little-endian uint64 values, one per block.
 */
export declare function buildExrOffsetTable(options: BuildExrOffsetTableOptions): Uint8Array;
export interface BuildExrOffsetTableFromBlocksOptions {
    /** Byte offset in the file where the offset table starts */
    offsetTableStart: number;
    /** Pre-built blocks (each has y + dataSize + data) */
    blocks: Uint8Array[];
}
/**
 * Build offset table from actual block data (for variable-size compressed blocks)
 */
export declare function buildExrOffsetTableFromBlocks(options: BuildExrOffsetTableFromBlocksOptions): Uint8Array;
