/**
 * XMP metadata generator for gain map images.
 * Structure matches gainmap-js (https://github.com/MONOGRID/gainmap-js) and libultrahdr jpegrutils.cpp:
 * primary XMP = Container:Directory + hdrgm:Version; secondary XMP = full hdrgm params (GainMapMin/Max, Gamma, etc.).
 * Viewers like Apple Preview use this XMP to recognize Ultra HDR and apply HDR display.
 */
import type { GainMapMetadataExtended } from '../types.js';
/**
 * Generate XMP metadata for the primary image
 */
export declare function generateXmpForPrimaryImage(secondaryImageLength: number, metadata: GainMapMetadataExtended): string;
/**
 * Generate XMP metadata for the secondary (gain map) image
 */
export declare function generateXmpForSecondaryImage(metadata: GainMapMetadataExtended): string;
