/**
 * EXR scan line block writer
 * Writes a single scan line block: y (4) + dataSize (4) + pixelData
 */
import type { HdrifyImage } from '../hdrifyImage.js';
import type { ExrChannel } from './exrTypes.js';
export interface WriteExrScanBlockOptions {
    hdrifyImage: HdrifyImage;
    firstLineY: number;
    lineCount: number;
    compression: number;
    channels: ExrChannel[];
}
/**
 * Write a single scan line block.
 * For NO_COMPRESSION: pixel-interleaved layout (R,G,B,A per pixel, left to right).
 * For RLE/ZIP: half-float, reorder + predictor + compress.
 * Block layout: y coordinate (4) + pixel data size (4) + pixel data.
 */
export declare function writeExrScanBlock(options: WriteExrScanBlockOptions): Uint8Array;
