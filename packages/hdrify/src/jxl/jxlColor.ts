/** JPEG XL encoded colour ↔ linear-light conversion, shared by composition and public output. */
import { readIccCicp, readIccProfile, readIccRgbTransform, type IccRgbTransform } from 'hdrify-icc';
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
const cache = new WeakMap<JxlImageHeader, ColorTransform>();
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

function iccTransform(h: JxlImageHeader): { rgb?: IccRgbTransform; ce?: JxlColorEncoding } {
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

function transform(h: JxlImageHeader): ColorTransform {
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
        transferFunction: h.bitDepth.floatSample ? 'linear' : 'srgb',
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

function matrix(m: Mat3, v: number[]): number[] {
  return m.map((r) => r[0] * v[0]! + r[1] * v[1]! + r[2] * v[2]!);
}
function ootf(v: number[], h: JxlImageHeader, t: ColorTransform, forward: boolean): number[] {
  if (!t.hlgLuminances) return v;
  const intensity = h.toneMapping.intensityTarget;
  if (295 <= intensity && intensity <= 305) return v;
  let gamma = 1.2 * 1.111 ** Math.log2(intensity / 1000);
  if (!forward) gamma = 1 / gamma;
  const y = t.hlgLuminances.reduce((sum, w, c) => sum + w * v[c]!, 0);
  const ratio = y ** (gamma - 1);
  if (!Number.isFinite(ratio)) return v;
  const out = v.map((x) => x * ratio);
  // libjxl's HLG CMS preserves hue and saturation when gamma < 1 causes an overshoot.
  if (forward && gamma < 1) {
    const max = Math.max(...out);
    if (max > 1) return out.map((x) => x / max);
  }
  return out;
}

/** Convert linear-sRGB XYB output into the image's encoded space before blending/referencing. */
export function xybFromLinear(h: JxlImageHeader, planes: Float32Array[]): void {
  const t = transform(h),
    n = planes[0]!.length;
  for (let i = 0; i < n; i++) {
    let v = matrix(t.fromSrgb, [planes[0]![i]!, planes[1]![i]!, planes[2]![i]!]);
    v = ootf(v, h, t, false);
    for (let c = 0; c < 3; c++) planes[c]![i] = t.encode[c]!(v[c]!);
  }
}

/** Final RGBA conversion. XYB frames kept linear are linear sRGB; encoded canvases retain original primaries. */
export function convertOutputColor(h: JxlImageHeader, out: Float32Array, linear: boolean): LinearColorSpace {
  if (linear) return 'linear-rec709';
  const t = transform(h);
  for (let i = 0; i < out.length; i += 4) {
    let v = [t.decode[0]!(out[i]!), t.decode[1]!(out[i + 1]!), t.decode[2]!(out[i + 2]!)];
    v = matrix(t.toOutput, ootf(v, h, t, true));
    for (let c = 0; c < 3; c++) out[i + c] = v[c]!;
  }
  return t.space;
}

export function jxlColorMetadata(h: JxlImageHeader): Record<string, unknown> {
  return {
    originalChromaticities: jxlChromaticities(h.colorEncoding),
    linearReferenceWhiteNits: h.toneMapping.intensityTarget,
    ...(h.colorEncoding.transferFunction === 'hlg' && { hlgLight: 'display', hlgOotf: 'libjxl intensity-target OOTF' }),
    ...(h.colorEncoding.wantIcc && { iccColorManaged: transform(h).iccManaged }),
  };
}
