/**
 * sRGB ICC profile matching the reference memorial.jpg (Google Inc. 2016).
 * Used as default for Ultra HDR gain map JPEG output so Apple Preview recognizes the file.
 * Format: JPEG APP2 payload (ICC_PROFILE\0 + chunk 1/1 + profile bytes).
 */

const SRGB_PROFILE_B64 =
  // biome-ignore lint/security/noSecrets: base64 string is not a secret
  'AAAByAAAAAAEMAAAbW50clJHQiBYWVogB+AAAQABAAAAAAAAYWNzcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAPbWAAEAAAAA0y0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAAAkclhZWgAAARQAAAAUZ1hZWgAAASgAAAAUYlhZWgAAATwAAAAUd3RwdAAAAVAAAAAUclRSQwAAAWQAAAAoZ1RSQwAAAWQAAAAoYlRSQwAAAWQAAAAoY3BydAAAAYwAAAA8bWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCWFlaIAAAAAAAAG+iAAA49QAAA5BYWVogAAAAAAAAYpkAALeFAAAY2lhZWiAAAAAAAAAkoAAAD4QAALbPWFlaIAAAAAAAAPbWAAEAAAAA0y1wYXJhAAAAAAAEAAAAAmZmAADypwAADVkAABPQAAAKWwAAAAAAAAAAbWx1YwAAAAAAAAABAAAADGVuVVMAAAAgAAAAHABHAG8AbwBnAGwAZQAgAEkAbgBjAC4AIAAyADAAMQA2';

const ICC_PREFIX = new TextEncoder().encode('ICC_PROFILE\0');

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

let cached: Uint8Array | null = null;

/**
 * Build JPEG APP2 payload with sRGB ICC profile (reference-compatible).
 */
export function buildSrgbIccPayload(): Uint8Array {
  if (cached) return cached;
  const profile = base64ToUint8Array(SRGB_PROFILE_B64);
  const payload = new Uint8Array(ICC_PREFIX.length + 2 + profile.length);
  payload.set(ICC_PREFIX, 0);
  payload[12] = 1; // chunk index
  payload[13] = 1; // total chunks
  payload.set(profile, 14);
  cached = payload;
  return payload;
}
