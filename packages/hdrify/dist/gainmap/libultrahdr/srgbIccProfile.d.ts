/**
 * sRGB ICC profile matching the reference memorial.jpg (Google Inc. 2016).
 * Used as default for Ultra HDR gain map JPEG output so Apple Preview recognizes the file.
 * Format: JPEG APP2 payload (ICC_PROFILE\0 + chunk 1/1 + profile bytes).
 */
/**
 * Build JPEG APP2 payload with sRGB ICC profile (reference-compatible).
 */
export declare function buildSrgbIccPayload(): Uint8Array;
