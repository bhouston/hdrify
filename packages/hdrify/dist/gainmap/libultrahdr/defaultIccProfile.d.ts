/**
 * Default ICC profile for Ultra HDR JPEG output.
 * sRGB profile matching reference memorial.jpg (Google Inc. 2016) for Apple Preview compatibility.
 * Format: JPEG APP2 payload (ICC_PROFILE\0 + chunk index + total chunks + profile bytes).
 */
/** Default ICC profile (APP2 payload) to embed in Ultra HDR JPEGs for Apple Preview recognition. */
export declare function getDefaultIccProfile(): Uint8Array;
/** Same as getDefaultIccProfile(); kept for backward compatibility. */
export declare const DEFAULT_ICC_PROFILE: Uint8Array;
