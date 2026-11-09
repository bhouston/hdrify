/** JPEG XL encoded colour ↔ linear-light conversion, shared by composition and public output. */
import { readIccCicp, readIccProfile } from 'hdrify-icc';
import { readIccRgbTransform, type IccRgbTransform } from '../color/iccTransform.js';
import {
  CHROMATICITIES_P3,
  CHROMATICITIES_REC2020,
  CHROMATICITIES_REC709,
  type Chromaticities,
} from '../color/chromaticities.js';
import type { LinearColorSpace } from '../color/colorSpaces.js';
import {
  bradfordAdaptation,
  buildAdaptedLinearMatrix,
  chromaticitiesToRgbXyzMatrix,
  chromaticitiesToXyzRgbMatrix,
  invert3,
  multiply3,
  type Mat3,
} from '../color/matrixConversion.js';
import { linearToSrgb as linearTosRGB, srgbToLinear as sRGBToLinear } from './jxlXyb.js';
import { hlgToScene, nitsToPq, pqToNits, sceneToHlg } from '../color/transfer.js';
import type { JxlColorEncoding, JxlImageHeader } from './jxlImageHeader.js';

const D50 = [0.34567, 0.3585];
const D65 = [0.3127, 0.329];
const identity: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
interface ColorTransform {
  space: LinearColorSpace;
  toOutput: Mat3;
  toSrgb: Mat3;
  fromSrgb: Mat3;
  decode: ((v: number) => number)[];
  encode: ((v: number) => number)[];
  hlgLuminances?: number[];
  iccManaged?: boolean;
}
/** The header fields colour conversion reads; the encoder passes just these. */
type JxlColorHeader = Pick<JxlImageHeader, 'colorEncoding' | 'toneMapping'> &
  Partial<Pick<JxlImageHeader, 'bitDepth' | 'icc'>>;
const cache = new WeakMap<JxlColorHeader, ColorTransform>();
const signedPower = (v: number, power: number) => Math.sign(v) * Math.abs(v) ** power;

/** Chromaticities of the original encoding, retained in metadata when converted to a supported space. */
export function jxlChromaticities(ce: JxlColorEncoding): Chromaticities {
  const ch = {
    ...(ce.primaries === 'p3'
      ? CHROMATICITIES_P3
      : ce.primaries === 'bt2100'
        ? CHROMATICITIES_REC2020
        : CHROMATICITIES_REC709),
  };
  if (ce.primaries === 'custom' && ce.primariesXy) {
    [[ch.redX, ch.redY], [ch.greenX, ch.greenY], [ch.blueX, ch.blueY]] = ce.primariesXy;
  }
  [ch.whiteX, ch.whiteY] =
    ce.whitePoint === 'custom'
      ? ce.whiteXy!
      : ce.whitePoint === 'dci'
        ? [0.314, 0.351]
        : ce.whitePoint === 'e'
          ? [1 / 3, 1 / 3]
          : [0.3127, 0.329];
  const matrix = chromaticitiesToRgbXyzMatrix(ch);
  if (![...matrix.flat(), ...invert3(matrix).flat()].every(Number.isFinite))
    throw new Error('JXL: invalid colour encoding chromaticities');
  return ch;
}

function curves(ce: JxlColorEncoding, intensity: number): [(v: number) => number, (v: number) => number] {
  switch (ce.transferFunction) {
    case 'linear':
      return [(x) => x, (x) => x];
    case 'srgb':
      return [sRGBToLinear, linearTosRGB];
    case 'pq':
      return [(x) => pqToNits(x) / intensity, (x) => nitsToPq(x * intensity)];
    case 'hlg':
      return [hlgToScene, sceneToHlg];
    case 'gamma':
      return [(x) => signedPower(x, 1 / ce.gamma!), (x) => signedPower(x, ce.gamma!)];
    case 'dci':
      return [(x) => signedPower(x, 2.6), (x) => signedPower(x, 1 / 2.6)];
    case 'bt709':
      return [
        (x) => Math.sign(x) * (Math.abs(x) < 0.081 ? Math.abs(x) / 4.5 : ((Math.abs(x) + 0.099) / 1.099) ** (1 / 0.45)),
        (x) => Math.sign(x) * (Math.abs(x) < 0.018 ? Math.abs(x) * 4.5 : 1.099 * Math.abs(x) ** 0.45 - 0.099),
      ];
    default:
      throw new Error(`JXL: transfer function '${ce.transferFunction}' is not supported yet`);
  }
}

function iccTransform(h: JxlColorHeader): { rgb?: IccRgbTransform; ce?: JxlColorEncoding } {
  if (!h.icc) return {};
  const p = readIccProfile(h.icc),
    cicp = readIccCicp(p);
  if (cicp && cicp.matrix === 0 && cicp.fullRange) {
    const primaries =
      cicp.primaries === 1 ? 'srgb' : cicp.primaries === 9 ? 'bt2100' : cicp.primaries === 12 ? 'p3' : undefined;
    const transferFunction = ({ 1: 'bt709', 8: 'linear', 13: 'srgb', 16: 'pq', 18: 'hlg' } as const)[
      cicp.transfer as 1
    ];
    if (primaries && transferFunction)
      return { ce: { ...h.colorEncoding, wantIcc: false, primaries, whitePoint: 'd65', transferFunction } };
  }
  return { rgb: readIccRgbTransform(p) };
}

function transform(h: JxlColorHeader): ColorTransform {
  const existing = cache.get(h);
  if (existing) return existing;
  let ce = h.colorEncoding,
    rgb: IccRgbTransform | undefined,
    iccManaged: boolean | undefined;
  if (ce.wantIcc) {
    const icc = iccTransform(h);
    rgb = icc.rgb;
    ce = icc.ce ?? ce;
    iccManaged = !!(icc.rgb || icc.ce);
    if (!iccManaged)
      ce = {
        ...ce,
        primaries: 'srgb',
        whitePoint: 'd65',
        transferFunction: h.bitDepth?.floatSample ? 'linear' : 'srgb',
      };
  }
  const ch = jxlChromaticities(ce);
  let toSrgb: Mat3,
    toOutput: Mat3,
    space: LinearColorSpace,
    decode: ColorTransform['decode'],
    encode: ColorTransform['encode'];
  if (rgb) {
    const toD65 = multiply3(bradfordAdaptation(D50, D65), rgb.matrix);
    toSrgb = multiply3(chromaticitiesToXyzRgbMatrix(CHROMATICITIES_REC709), toD65);
    toOutput = multiply3(chromaticitiesToXyzRgbMatrix(CHROMATICITIES_REC2020), toD65);
    space = 'linear-rec2020';
    decode = rgb.curves.map((c) => c.evaluate);
    encode = rgb.curves.map((c) => c.inverse);
  } else {
    const native = ce.whitePoint === 'd65' && ce.primaries !== 'custom';
    space = native
      ? ce.primaries === 'p3'
        ? 'linear-p3'
        : ce.primaries === 'bt2100'
          ? 'linear-rec2020'
          : 'linear-rec709'
      : 'linear-rec2020';
    const outputCh =
      space === 'linear-p3'
        ? CHROMATICITIES_P3
        : space === 'linear-rec2020'
          ? CHROMATICITIES_REC2020
          : CHROMATICITIES_REC709;
    toOutput = native ? identity : buildAdaptedLinearMatrix(ch, outputCh);
    toSrgb = buildAdaptedLinearMatrix(ch, CHROMATICITIES_REC709);
    const [d, e] = curves(ce, h.toneMapping.intensityTarget);
    decode = [d, d, d];
    encode = [e, e, e];
  }
  if (![...toOutput.flat(), ...toSrgb.flat(), ...invert3(toSrgb).flat()].every(Number.isFinite))
    throw new Error('JXL: invalid colour encoding matrix');
  const result: ColorTransform = {
    space,
    toOutput,
    toSrgb,
    fromSrgb: invert3(toSrgb),
    decode,
    encode,
    iccManaged,
    ...(ce.transferFunction === 'hlg' && { hlgLuminances: chromaticitiesToRgbXyzMatrix(ch)[1] }),
  };
  cache.set(h, result);
  return result;
}

/** HLG OOTF luminance weights and gamma, or undefined when the OOTF is a no-op (loop-invariant). */
function ootfParams(h: JxlColorHeader, t: ColorTransform, forward: boolean) {
  if (!t.hlgLuminances) return undefined;
  const intensity = h.toneMapping.intensityTarget;
  if (295 <= intensity && intensity <= 305) return undefined;
  let gamma = 1.2 * 1.111 ** Math.log2(intensity / 1000);
  if (!forward) gamma = 1 / gamma;
  const w = t.hlgLuminances;
  // libjxl's HLG CMS preserves hue and saturation when gamma < 1 causes an overshoot.
  return { w0: w[0]!, w1: w[1]!, w2: w[2]!, exponent: gamma - 1, normalize: forward && gamma < 1 };
}

/**
 * Convert linear-sRGB XYB output into the image's encoded space before blending/referencing.
 * With `native`, planes are already linear in the encoding's own primaries (the encoder's input).
 */
export function xybFromLinear(h: JxlColorHeader, planes: Float32Array[], native = false): void {
  const t = transform(h),
    n = planes[0]!.length;
  const p0 = planes[0]!,
    p1 = planes[1]!,
    p2 = planes[2]!;
  const e0 = t.encode[0]!,
    e1 = t.encode[1]!,
    e2 = t.encode[2]!;
  const m = native ? identity : t.fromSrgb,
    id = m === identity;
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = m;
  const o = ootfParams(h, t, false);
  for (let i = 0; i < n; i++) {
    let r = p0[i]!,
      g = p1[i]!,
      b = p2[i]!;
    // Identity preserves native float channels, including nonfinite values and signed zero.
    if (!id) {
      const x = m00 * r + m01 * g + m02 * b,
        y = m10 * r + m11 * g + m12 * b;
      b = m20 * r + m21 * g + m22 * b;
      r = x;
      g = y;
    }
    if (o) {
      const ratio = (0 + o.w0 * r + o.w1 * g + o.w2 * b) ** o.exponent;
      if (Number.isFinite(ratio)) {
        r *= ratio;
        g *= ratio;
        b *= ratio;
        if (o.normalize) {
          const max = Math.max(r, g, b);
          if (max > 1) {
            r /= max;
            g /= max;
            b /= max;
          }
        }
      }
    }
    p0[i] = e0(r);
    p1[i] = e1(g);
    p2[i] = e2(b);
  }
}

/** Final RGBA conversion. XYB frames kept linear are linear sRGB; encoded canvases retain original primaries. */
export function convertOutputColor(h: JxlImageHeader, out: Float32Array, linear: boolean): LinearColorSpace {
  if (linear) return 'linear-rec709';
  const t = transform(h);
  const d0 = t.decode[0]!,
    d1 = t.decode[1]!,
    d2 = t.decode[2]!;
  const m = t.toOutput,
    id = m === identity;
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = m;
  const o = ootfParams(h, t, true);
  for (let i = 0; i < out.length; i += 4) {
    let r = d0(out[i]!),
      g = d1(out[i + 1]!),
      b = d2(out[i + 2]!);
    if (o) {
      const ratio = (0 + o.w0 * r + o.w1 * g + o.w2 * b) ** o.exponent;
      if (Number.isFinite(ratio)) {
        r *= ratio;
        g *= ratio;
        b *= ratio;
        if (o.normalize) {
          const max = Math.max(r, g, b);
          if (max > 1) {
            r /= max;
            g /= max;
            b /= max;
          }
        }
      }
    }
    if (!id) {
      out[i] = m00 * r + m01 * g + m02 * b;
      out[i + 1] = m10 * r + m11 * g + m12 * b;
      out[i + 2] = m20 * r + m21 * g + m22 * b;
    } else {
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
    }
  }
  return t.space;
}

export function jxlColorMetadata(h: JxlImageHeader): Record<string, unknown> {
  return {
    ...(!h.colorEncoding.wantIcc && { originalChromaticities: jxlChromaticities(h.colorEncoding) }),
    linearReferenceWhiteNits: h.toneMapping.intensityTarget,
    ...(h.colorEncoding.transferFunction === 'hlg' && { hlgLight: 'display', hlgOotf: 'libjxl intensity-target OOTF' }),
    ...(h.colorEncoding.wantIcc && { iccColorManaged: transform(h).iccManaged }),
  };
}
