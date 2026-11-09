/**
 * Shared ICC colour-management policy for every format: hdrify converts the profiles it can evaluate
 * (recognized cICP, matrix/TRC RGB, gray TRC) and throws a descriptive error for everything else.
 */
import { readIccCicp, readIccProfile } from 'hdrify-icc';
import { CHROMATICITIES_REC2020 } from './chromaticities.js';
import { LINEAR_COLOR_SPACES, LINEAR_TO_CHROMATICITIES, type LinearColorSpace } from './colorSpaces.js';
import { readIccRgbTransform, type IccRgbTransform } from './iccTransform.js';
import {
  bradfordAdaptation,
  chromaticitiesToRgbXyzMatrix,
  chromaticitiesToXyzRgbMatrix,
  multiply3,
  type Mat3,
} from './matrixConversion.js';
import { sRGBToLinear } from './srgb.js';

/** A cICP tag hdrify maps to a known encoding (full-range RGB, D65 white). */
export interface IccCicpEncoding {
  primaries: 'srgb' | 'p3' | 'bt2100';
  transferFunction: 'bt709' | 'linear' | 'srgb' | 'pq' | 'hlg';
}
export type IccColorInterpretation =
  | { cicp: IccCicpEncoding; rgb?: undefined }
  | { rgb: IccRgbTransform; cicp?: undefined };

/**
 * Interpret an embedded ICC profile. A recognized cICP tag wins; otherwise the matrix/TRC RGB or gray kTRC
 * model is used. LUT-based, CMYK, Lab and other profiles throw `<format>: embedded ICC profile cannot be
 * colour-managed (...)`.
 *
 * @param icc - Raw ICC profile bytes.
 * @param format - Error prefix naming the container, e.g. `JXL`.
 */
export function interpretIccProfile(icc: Uint8Array, format: string): IccColorInterpretation {
  const p = readIccProfile(icc),
    cicp = readIccCicp(p);
  if (cicp && cicp.matrix === 0 && cicp.fullRange) {
    const primaries = ({ 1: 'srgb', 9: 'bt2100', 12: 'p3' } as const)[cicp.primaries as 1];
    const transferFunction = ({ 1: 'bt709', 8: 'linear', 13: 'srgb', 16: 'pq', 18: 'hlg' } as const)[
      cicp.transfer as 1
    ];
    if (primaries && transferFunction) return { cicp: { primaries, transferFunction } };
  }
  const rgb = readIccRgbTransform(p);
  if (rgb) return { rgb };
  const sig = (o: number) => String.fromCharCode(...p.header.subarray(o, o + 4)).trim();
  const lut = p.tags.some((t) => /^(A2B|B2A|D2B|B2D)/.test(t.signature));
  throw new Error(
    `${format}: embedded ICC profile cannot be colour-managed ('${sig(12)}' class, '${sig(16)}' colour space, ` +
      `'${sig(20)}' PCS${lut ? ', LUT-based' : ''}); only matrix/TRC RGB, gray TRC and recognized cICP profiles ` +
      'are supported',
  );
}

/** SDR-referred RGB samples → linear light in `space`. */
export interface IccLinearRgb {
  /** The matching linear colour space, or `linear-rec2020` for other primaries. */
  space: LinearColorSpace;
  /** Per-channel encoded → linear light, still in the profile's own primaries. */
  decode: [(v: number) => number, (v: number) => number, (v: number) => number];
  /** Profile linear RGB → `space` (Bradford-adapted to D65); undefined when the primaries already match. */
  toOutput?: Mat3;
}

const D50 = [0.34567, 0.3585],
  D65 = [0.3127, 0.329];
const CICP_SPACES = { srgb: 'linear-rec709', p3: 'linear-p3', bt2100: 'linear-rec2020' } as const;
const bt709ToLinear = (x: number) =>
  Math.sign(x) * (Math.abs(x) < 0.081 ? Math.abs(x) / 4.5 : ((Math.abs(x) + 0.099) / 1.099) ** (1 / 0.45));

/**
 * The linear colour space whose RGB → XYZ matrix is within 0.001 (libultrahdr's gamut tolerance) of
 * `toD65`, a matrix/TRC profile's D65-adapted RGB → XYZ matrix; undefined for other primaries.
 */
export function matchLinearColorSpace(toD65: Mat3): LinearColorSpace | undefined {
  return LINEAR_COLOR_SPACES.find((s) =>
    chromaticitiesToRgbXyzMatrix(LINEAR_TO_CHROMATICITIES[s]).every((row, i) =>
      row.every((v, j) => Math.abs(v - toD65[i]![j]!) <= 0.001),
    ),
  );
}

/**
 * Linearization for SDR-referred RGB samples described by an ICC profile, following {@link interpretIccProfile}.
 * Matrix/TRC primaries within 0.001 of Rec.709, Display P3 or Rec.2020 (libultrahdr's gamut tolerance) map to
 * that space; other primaries are Bradford-adapted to linear Rec.2020. PQ/HLG cICP profiles throw because
 * their reference white is not defined for SDR samples.
 */
export function iccLinearRgb(icc: Uint8Array, format: string): IccLinearRgb {
  const { cicp, rgb } = interpretIccProfile(icc, format);
  if (cicp) {
    const tf = cicp.transferFunction;
    const d = tf === 'srgb' ? sRGBToLinear : tf === 'bt709' ? bt709ToLinear : tf === 'linear' ? (x: number) => x : 0;
    if (!d) throw new Error(`${format}: ICC cICP transfer '${tf}' is not supported for SDR-referred samples`);
    return { space: CICP_SPACES[cicp.primaries], decode: [d, d, d] };
  }
  const toD65 = multiply3(bradfordAdaptation(D50, D65), rgb.matrix);
  const decode = rgb.curves.map((c) => c.evaluate) as IccLinearRgb['decode'];
  const space = matchLinearColorSpace(toD65);
  if (space) return { space, decode };
  return {
    space: 'linear-rec2020',
    decode,
    toOutput: multiply3(chromaticitiesToXyzRgbMatrix(CHROMATICITIES_REC2020), toD65),
  };
}
