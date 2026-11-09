import { DEFAULT_ICC_PROFILE } from './defaultIccProfile.js';
import { buildJpegIccPayloads } from './jpegIcc.js';

export interface GainMapIccOptions {
  /** Legacy single JPEG APP2 payload (ICC_PROFILE header plus chunk 1/1). Null omits ICC. */
  icc?: Uint8Array | null;
  /** Raw ICC profile bytes, supporting multipart JPEG embedding. Null omits ICC.
   * Profiles are metadata only: callers are responsible for matching the encoded pixels. */
  iccProfile?: Uint8Array | null;
}

/** Normalize both public representations to validated, bounded JPEG APP2 chunks. */
export function gainMapIccPayloads(options: GainMapIccOptions): Uint8Array[] {
  if (options.icc !== undefined && options.iccProfile !== undefined)
    throw new Error('Specify either icc or iccProfile, not both');
  if (options.iccProfile !== undefined)
    return options.iccProfile === null ? [] : buildJpegIccPayloads(options.iccProfile);
  const payload = options.icc === undefined ? DEFAULT_ICC_PROFILE : options.icc;
  if (payload === null) return [];
  const prefix = new TextEncoder().encode('ICC_PROFILE\0');
  if (payload.length < 14 || prefix.some((b, i) => payload[i] !== b) || payload[12] !== 1 || payload[13] !== 1)
    throw new Error('icc must be a complete single ICC APP2 payload; use iccProfile for raw profile bytes');
  return buildJpegIccPayloads(payload.subarray(14));
}

/** Insert already validated APP2 payloads after a JPEG SOI. */
export function insertJpegIcc(jpeg: Uint8Array, payloads: Uint8Array[]): Uint8Array {
  if (payloads.length === 0) return jpeg;
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('ICC: expected JPEG SOI');
  const out = new Uint8Array(jpeg.length + payloads.reduce((n, p) => n + p.length + 4, 0));
  out.set(jpeg.subarray(0, 2));
  let offset = 2;
  for (const p of payloads) {
    out.set([0xff, 0xe2, (p.length + 2) >>> 8, (p.length + 2) & 255], offset);
    out.set(p, offset + 4);
    offset += p.length + 4;
  }
  out.set(jpeg.subarray(2), offset);
  return out;
}
