/**
 * Extract gain map XMP metadata from a JPEG buffer.
 * Supports hdrgm:* attributes (UltraHDR / Adobe gain map).
 * Throws if no gain map metadata is found.
 */
import type { GainMapMetadata } from '../types.js';
/**
 * Scan buffer for XMP blocks and return gain map metadata from the first block
 * that contains hdrgm:* (gain map descriptor). Skips primary container descriptor
 * (Container:Directory only, no hdrgm:Version).
 * @throws if no gain map XMP block is found
 */
export declare function extractGainMapXmp(buffer: Uint8Array): GainMapMetadata;
