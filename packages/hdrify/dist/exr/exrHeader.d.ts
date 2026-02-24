/**
 * EXR header parsing
 * Parses magic, version, and attributes including chlist, displayWindow, dataWindow, compression
 */
import type { ParsedExrHeader } from './exrTypes.js';
/**
 * Parse EXR file header from buffer.
 * Returns parsed header and the byte offset immediately after the header.
 *
 * @param exrBuffer - Full EXR file buffer
 * @returns Parsed header and offset after header
 */
export declare function parseExrHeader(exrBuffer: Uint8Array): {
    header: ParsedExrHeader;
    offset: number;
};
