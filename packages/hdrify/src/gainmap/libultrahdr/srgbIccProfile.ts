/** Reference-compatible sRGB JPEG APP2 payload, retained for existing callers. */
import { createSrgbIccProfile } from 'hdrify-icc';
import { buildJpegIccPayloads } from './jpegIcc.js';

let cached: Uint8Array | null = null;

export function buildSrgbIccPayload(): Uint8Array {
  cached ??= buildJpegIccPayloads(createSrgbIccProfile())[0]!;
  return cached;
}
