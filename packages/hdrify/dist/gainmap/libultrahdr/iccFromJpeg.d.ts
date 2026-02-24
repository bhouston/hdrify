/**
 * Extract ICC profile and ADGC tag info from a JPEG (for tests and inspection).
 * JPEG APP2 with "ICC_PROFILE\0" carries the profile; ICC tag table at offset 128.
 */
/**
 * Finds the first APP2 segment with ICC_PROFILE and returns the raw ICC profile bytes (no APP2 header).
 */
export declare function extractIccProfileFromJpeg(jpeg: Uint8Array): Uint8Array | null;
/**
 * Returns the 16-byte ADGC GUID from an ICC profile, or null if the profile has no ADGC tag.
 */
export declare function getAdgcGuidFromIccProfile(profile: Uint8Array): Uint8Array | null;
/**
 * Returns true if the ICC profile contains an ADGC tag.
 */
export declare function iccProfileHasAdgcTag(profile: Uint8Array): boolean;
