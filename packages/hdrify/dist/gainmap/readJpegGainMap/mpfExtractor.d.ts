/**
 * Extract SDR and gain map image blobs from a JPEG-R buffer using MPF (Multi-Picture Format).
 * Supports CIPA DC-007 layout (our writer) and fixed 60-byte layout (UltraHDRLoader).
 * Throws if primary or gain map image cannot be extracted.
 */
export interface MpfExtractResult {
    primaryImage: Uint8Array;
    gainmapImage: Uint8Array;
    /** Format hint: 'ultrahdr' when structure matches UltraHDR/JPEG-R */
    format: 'ultrahdr' | 'adobe-gainmap';
}
/**
 * Segment-walk: find APP2 with MPF signature, then parse MP entries to get primary
 * and gain map byte ranges. Returns JPEG blobs each starting with SOI (0xFF 0xD8).
 */
export declare function extractImagesFromMpf(buffer: Uint8Array): MpfExtractResult;
/**
 * Fallback when MPF is not present: find the second SOI (0xFF 0xD8).
 * Prefer one that immediately follows EOI (0xFF 0xD9); otherwise use first SOI after byte 2.
 * Primary = 0 to second SOI; gain map = second SOI to end.
 */
export declare function extractImagesBySecondSoi(buffer: Uint8Array): MpfExtractResult;
