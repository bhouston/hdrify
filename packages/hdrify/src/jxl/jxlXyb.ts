/**
 * XYB -> linear sRGB (ISO/IEC 18181-1 L.2 / libjxl dec_xyb-inl.h XybToRgb) and
 * YCbCr -> RGB (L.3) colour conversions, in place on planar Float32Array buffers.
 */

/** libjxl cms/opsin_params.h kDefaultInverseOpsinAbsorbanceMatrix (row-major 3x3). */
export const JXL_DEFAULT_INVERSE_OPSIN_MATRIX: readonly number[] = [
  11.031566901960783, -9.866943921568629, -0.16462299647058826, -3.254147380392157, 4.418770392156863,
  -0.16462299647058826, -3.6588512862745097, 2.7129230470588235, 1.9459282392156863,
];

/** Default opsin bias (OpsinInverseMatrix.opsin_bias = -kOpsinAbsorbanceBias). */
export const JXL_DEFAULT_OPSIN_BIAS: readonly number[] = [
  -0.0037930732552754493, -0.0037930732552754493, -0.0037930732552754493,
];

/** Forward opsin absorbance matrix (libjxl kOpsinAbsorbanceMatrix), useful for encoders/tests. */
export const JXL_OPSIN_ABSORBANCE_MATRIX: readonly number[] = [
  0.3, 0.622, 0.078, 0.23, 0.692, 0.078, 0.2434226892454782, 0.2047674442449682, 0.5518098665095535,
];

/** Parameters of the opsin inverse (ImageMetadata.opsin_inverse_matrix + tone mapping). */
export interface JxlOpsinInverseParams {
  readonly inverseMatrix?: readonly number[];
  readonly opsinBias?: readonly number[];
  /** ToneMapping.intensity_target in nits (default 255). Output is scaled by 255 / intensityTarget. */
  readonly intensityTarget?: number;
}

/**
 * Converts XYB planes to linear sRGB in place (`x` -> R, `y` -> G, `b` -> B):
 * `L = (Y + X - cbrt(bias))^3 + bias`, `M = (Y - X - cbrt(bias))^3 + bias`,
 * `S = (B - cbrt(bias))^3 + bias`, then `rgb = inverseMatrix * 255/intensityTarget * LMS`.
 * Linear 1.0 corresponds to `intensityTarget` nits.
 */
export function xybToLinearSrgb(
  x: Float32Array,
  y: Float32Array,
  b: Float32Array,
  n: number,
  params: JxlOpsinInverseParams = {},
): void {
  const m = params.inverseMatrix ?? JXL_DEFAULT_INVERSE_OPSIN_MATRIX;
  const bias = params.opsinBias ?? JXL_DEFAULT_OPSIN_BIAS;
  const s = 255 / (params.intensityTarget ?? 255);
  const m0 = m[0]! * s,
    m1 = m[1]! * s,
    m2 = m[2]! * s;
  const m3 = m[3]! * s,
    m4 = m[4]! * s,
    m5 = m[5]! * s;
  const m6 = m[6]! * s,
    m7 = m[7]! * s,
    m8 = m[8]! * s;
  const b0 = bias[0]!,
    b1 = bias[1]!,
    b2 = bias[2]!;
  const c0 = Math.cbrt(b0),
    c1 = Math.cbrt(b1),
    c2 = Math.cbrt(b2);
  for (let i = 0; i < n; i++) {
    const vx = x[i]!;
    const vy = y[i]!;
    const gl = vy + vx - c0;
    const gm = vy - vx - c1;
    const gs = b[i]! - c2;
    const l = gl * gl * gl + b0;
    const mm = gm * gm * gm + b1;
    const sh = gs * gs * gs + b2;
    x[i] = m0 * l + m1 * mm + m2 * sh;
    y[i] = m3 * l + m4 * mm + m5 * sh;
    b[i] = m6 * l + m7 * mm + m8 * sh;
  }
}

/**
 * YCbCr -> RGB in place for `do_YCbCr` frames (planes are Cb, Y, Cr as stored in
 * the codestream; outputs R, G, B into the same planes). Y is offset by 128/255.
 */
export function ycbcrToRgb(cb: Float32Array, y: Float32Array, cr: Float32Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const vcb = cb[i]!;
    const vy = y[i]! + 128 / 255;
    const vcr = cr[i]!;
    cb[i] = vy + 1.402 * vcr;
    y[i] = vy - ((0.114 * 1.772) / 0.587) * vcb - ((0.299 * 1.402) / 0.587) * vcr;
    cr[i] = vy + 1.772 * vcb;
  }
}

/** sRGB EOTF (encoded -> linear), sign-preserving for out-of-gamut values. */
export function srgbToLinear(v: number): number {
  const a = Math.abs(v);
  const r = a <= 0.04045 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4);
  return v < 0 ? -r : r;
}

/** sRGB inverse EOTF (linear -> encoded), sign-preserving for out-of-gamut values. */
export function linearToSrgb(v: number): number {
  const a = Math.abs(v);
  const r = a <= 0.0031308 ? a * 12.92 : 1.055 * Math.pow(a, 1 / 2.4) - 0.055;
  return v < 0 ? -r : r;
}
