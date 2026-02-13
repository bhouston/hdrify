/**
 * Default ICC profile for Ultra HDR JPEG output.
 * sRGB profile matching reference memorial.jpg (Google Inc. 2016) for Apple Preview compatibility.
 * Format: JPEG APP2 payload (ICC_PROFILE\0 + chunk index + total chunks + profile bytes).
 */

import { buildSrgbIccPayload } from './srgbIccProfile.js';

let cached: Uint8Array | null = null;

/** Default ICC profile (APP2 payload) to embed in Ultra HDR JPEGs for Apple Preview recognition. */
export function getDefaultIccProfile(): Uint8Array {
  if (!cached) cached = buildSrgbIccPayload();
  return cached;
}

/** Same as getDefaultIccProfile(); kept for backward compatibility. */
export const DEFAULT_ICC_PROFILE: Uint8Array = getDefaultIccProfile();
