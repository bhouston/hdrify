/** Backwards-compatible JPEG ICC inspection entry points. */
import { readIccAdgcGuid, readIccProfile } from 'hdrify-icc';
export { extractJpegIccProfile as extractIccProfileFromJpeg } from './jpegIcc.js';

/** Return the Adobe gain-map GUID, or null for an absent tag or invalid ICC profile. */
export function getAdgcGuidFromIccProfile(profile: Uint8Array): Uint8Array | null {
  try {
    return readIccAdgcGuid(readIccProfile(profile)) ?? null;
  } catch {
    return null;
  }
}

export function iccProfileHasAdgcTag(profile: Uint8Array): boolean {
  return getAdgcGuidFromIccProfile(profile) !== null;
}
