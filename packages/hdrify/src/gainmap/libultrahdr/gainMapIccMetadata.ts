import { iccLinearRgb } from '../../color/iccPolicy.js';
import { sRGBToLinear } from '../../color/srgb.js';
import { DEFAULT_ICC_PROFILE } from './defaultIccProfile.js';
import { buildJpegIccPayloads } from './jpegIcc.js';

export interface GainMapIccOptions {
  /**
   * Legacy complete JPEG APP2 payload, including the ICC_PROFILE header and chunk 1/1.
   * Defaults to the reference sRGB profile when neither ICC option is supplied.
   * The profile must describe sRGB, as for `iccProfile`.
   * Set to null to omit ICC. Mutually exclusive with `iccProfile`.
   */
  icc?: Uint8Array | null;
  /**
   * Raw complete ICC profile bytes, split across JPEG APP2 segments when needed.
   * Structure is validated; bytes, unknown tags, and profile IDs are retained verbatim.
   * `encodeGainMap` produces an sRGB base and pixels are not converted, so the profile must describe sRGB:
   * Rec.709 primaries (within 0.001) and sRGB curves (within 0.001 linear), or an sRGB cICP tag.
   * Other profiles, including Display P3 and LUT/CMYK profiles, throw.
   * Defaults to the reference sRGB profile. Set to null to omit ICC.
   * Mutually exclusive with `icc`.
   */
  iccProfile?: Uint8Array | null;
}

const SAMPLES = Array.from({ length: 33 }, (_, i) => i / 32);

/** Validated APP2 chunks for a profile that describes the sRGB samples `encodeGainMap` produces. */
function srgbPayloads(profile: Uint8Array): Uint8Array[] {
  const payloads = buildJpegIccPayloads(profile);
  const { space, toOutput, decode } = iccLinearRgb(profile, 'Gain map JPEG');
  if (
    space !== 'linear-rec709' ||
    toOutput ||
    !decode.every((d) => SAMPLES.every((v) => Math.abs(d(v) - sRGBToLinear(v)) <= 0.001))
  )
    throw new Error(
      'Gain map JPEG: ICC profile does not describe sRGB; encodeGainMap produces an sRGB base and pixels are not converted',
    );
  return payloads;
}

/** Normalize both public representations to validated, bounded JPEG APP2 chunks. */
export function gainMapIccPayloads(options: GainMapIccOptions): Uint8Array[] {
  if (options.icc !== undefined && options.iccProfile !== undefined)
    throw new Error('Specify either icc or iccProfile, not both');
  if (options.iccProfile !== undefined) return options.iccProfile === null ? [] : srgbPayloads(options.iccProfile);
  const payload = options.icc === undefined ? DEFAULT_ICC_PROFILE : options.icc;
  if (payload === null) return [];
  const prefix = new TextEncoder().encode('ICC_PROFILE\0');
  if (payload.length < 14 || prefix.some((b, i) => payload[i] !== b) || payload[12] !== 1 || payload[13] !== 1)
    throw new Error('icc must be a complete single ICC APP2 payload; use iccProfile for raw profile bytes');
  return srgbPayloads(payload.subarray(14));
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
