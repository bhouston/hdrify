/**
 * PIZ Huffman decompression
 * Used by PIZ compression for OpenEXR
 */
/**
 * Compress raw uint16 data using Huffman encoding.
 * Output format matches what hufUncompress expects: im(4), iM(4), tableLength(4), nBits(4), reserved(4), packed table, data.
 */
export declare function hufCompress(raw: Uint16Array): Uint8Array;
/**
 * Decompress Huffman-encoded data (PIZ compression)
 */
export declare function hufUncompress(uInt8Array: Uint8Array, inDataView: DataView, inOffset: {
    value: number;
}, nCompressed: number, outBuffer: Uint16Array, nRaw: number): void;
