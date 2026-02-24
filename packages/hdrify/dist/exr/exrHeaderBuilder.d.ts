/**
 * EXR header builder for writing
 * Builds header bytes from options. Output parses correctly via parseExrHeader.
 */
import type { Chromaticities } from '../color/chromaticities.js';
import type { ExrChannel } from './exrTypes.js';
export interface WriteExrHeaderOptions {
    width?: number;
    height?: number;
    compression?: number;
    channels?: Array<{
        name: string;
        pixelType?: number;
        xSampling?: number;
        ySampling?: number;
    }>;
    /** Chromaticities to write (8 floats: redX, redY, greenX, greenY, blueX, blueY, whiteX, whiteY) */
    chromaticities?: Chromaticities;
    /** Extra attributes to add before channels (e.g. for testing unknown attribute skip) */
    extraAttributes?: Array<{
        name: string;
        type: string;
        value: Uint8Array;
    }>;
    /** Attributes to omit (e.g. for testing required attributes) */
    omitAttributes?: string[];
}
declare const DEFAULT_CHANNELS: ExrChannel[];
/**
 * Build magic number and version field (8 bytes).
 * For single-part scanline files, version is 2.
 */
export declare function buildMagicAndVersion(options?: {
    magic?: number;
    version?: number;
}): Uint8Array;
/**
 * Build EXR header attributes (without magic/version).
 * Does not include the null terminator for single-part (per OpenEXR spec: omitted for single-part).
 */
export declare function buildExrHeader(options?: WriteExrHeaderOptions): Uint8Array;
/**
 * Build a complete EXR header buffer (magic + version + attributes) for parsing tests.
 * parseExrHeader can parse the result.
 */
export declare function buildExrHeaderForParsing(options?: Partial<WriteExrHeaderOptions> & {
    magic?: number;
    version?: number;
}): Uint8Array;
export { DEFAULT_CHANNELS };
