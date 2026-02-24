/**
 * Isolated validation of the PXR24 block/line decoder.
 *
 * These tests build the compressed payload BY HAND to match the OpenEXR/C++
 * layout exactly (line-major order, per-segment transpose, deltas stored
 * with high byte first). No use of our encoder — so we validate the
 * decoder against known-good inputs.
 *
 * Layout (OpenEXR reference):
 * - After zlib: for each scanline ly, for each channel c, one segment of
 *   (width * bytesPerSample) bytes.
 * - Each segment is transposed: stored as [all_byte0][all_byte1] (for HALF:
 *   [all_high][all_low]). So for 2 pixels, segment = [h0,h1, l0,l1].
 * - Each delta is signed 16-bit; in the segment (before transpose) we store
 *   high byte first: (diff >> 8), (diff & 0xff). So after transpose we have
 *   high bytes first in the segment, then low bytes.
 */
export {};
