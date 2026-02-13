/**
 * Extract ICC profile and ADGC tag info from a JPEG (for tests and inspection).
 * JPEG APP2 with "ICC_PROFILE\0" carries the profile; ICC tag table at offset 128.
 */

const APP2_MARKER = 0xe2;
const ICC_PREFIX = new TextEncoder().encode('ICC_PROFILE\0');
const ICC_PREFIX_LEN = 12;
const ICC_APP2_HEADER_LEN = ICC_PREFIX_LEN + 2; // + chunk index, total chunks
const ICC_HEADER_SIZE = 128;
const TAG_ENTRY_SIZE = 12;
const TAG_ADGC = 0x41444743; // 'ADGC'
const ADGC_GUID_OFFSET_IN_TAG = 12; // after type (4) + reserved (4) + function type (4)
const ADGC_GUID_SIZE = 16;

function hasIccPrefix(payload: Uint8Array): boolean {
  for (let k = 0; k < ICC_PREFIX_LEN; k++) {
    if (payload[k] !== ICC_PREFIX[k]) return false;
  }
  return true;
}

/**
 * Finds the first APP2 segment with ICC_PROFILE and returns the raw ICC profile bytes (no APP2 header).
 */
export function extractIccProfileFromJpeg(jpeg: Uint8Array): Uint8Array | null {
  let i = 0;
  while (i < jpeg.length - 4) {
    if (jpeg[i] !== 0xff || jpeg[i + 1] !== APP2_MARKER) {
      i++;
      continue;
    }
    const hi = jpeg[i + 2];
    const lo = jpeg[i + 3];
    if (hi === undefined || lo === undefined) {
      i++;
      continue;
    }
    const segLen = (hi << 8) | lo;
    const payloadStart = i + 4;
    const payloadEnd = payloadStart + (segLen - 2);
    if (payloadEnd > jpeg.length) break;
    const payload = jpeg.subarray(payloadStart, payloadEnd);
    if (payload.length >= ICC_APP2_HEADER_LEN && hasIccPrefix(payload)) {
      return payload.subarray(ICC_APP2_HEADER_LEN);
    }
    i = payloadEnd;
  }
  return null;
}

/**
 * Returns the 16-byte ADGC GUID from an ICC profile, or null if the profile has no ADGC tag.
 */
export function getAdgcGuidFromIccProfile(profile: Uint8Array): Uint8Array | null {
  const tableStart = ICC_HEADER_SIZE + 4;
  if (profile.length < tableStart + TAG_ENTRY_SIZE) return null;
  const dv = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const tagCount = dv.getUint32(ICC_HEADER_SIZE, false);
  const tableEnd = tableStart + tagCount * TAG_ENTRY_SIZE;
  if (profile.length < tableEnd) return null;
  for (let i = 0; i < tagCount; i++) {
    const entryOff = tableStart + i * TAG_ENTRY_SIZE;
    const sig = dv.getUint32(entryOff, false);
    if (sig !== TAG_ADGC) continue;
    const offset = dv.getUint32(entryOff + 4, false);
    const size = dv.getUint32(entryOff + 8, false);
    if (
      offset + ADGC_GUID_OFFSET_IN_TAG + ADGC_GUID_SIZE > profile.length ||
      size < ADGC_GUID_OFFSET_IN_TAG + ADGC_GUID_SIZE
    )
      return null;
    return profile
      .subarray(offset + ADGC_GUID_OFFSET_IN_TAG, offset + ADGC_GUID_OFFSET_IN_TAG + ADGC_GUID_SIZE)
      .slice();
  }
  return null;
}

/**
 * Returns true if the ICC profile contains an ADGC tag.
 */
export function iccProfileHasAdgcTag(profile: Uint8Array): boolean {
  return getAdgcGuidFromIccProfile(profile) !== null;
}
