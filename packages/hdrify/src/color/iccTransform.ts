/** ICC matrix/TRC interpretation and evaluation for image consumers. Profile data I/O lives in hdrify-icc. */
import type { IccMatrix, IccProfile } from 'hdrify-icc';

export interface IccCurve {
  evaluate: (v: number) => number;
  inverse: (v: number) => number;
}
export interface IccRgbTransform {
  matrix: IccMatrix;
  curves: [IccCurve, IccCurve, IccCurve];
}
const signature = (b: Uint8Array, off: number) => String.fromCharCode(...b.subarray(off, off + 4));
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const fixed = (d: DataView, off: number) => d.getInt32(off) / 65536;

function curve(evaluate: (v: number) => number, inverse?: (v: number) => number): IccCurve {
  return {
    evaluate,
    inverse:
      inverse ??
      ((y) => {
        // Matrix/TRC display profiles use monotonic curves. Binary inversion also handles table plateaus.
        let lo = 0,
          hi = 1;
        if (y <= evaluate(0)) return 0;
        if (y >= evaluate(1)) return 1;
        for (let i = 0; i < 32; i++) {
          const mid = (lo + hi) / 2;
          if (evaluate(mid) < y) lo = mid;
          else hi = mid;
        }
        return (lo + hi) / 2;
      }),
  };
}

/** ICC curveType and parametricCurveType (functions 0–4). Returns undefined for unsupported tag types. */
export function readIccCurve(bytes: Uint8Array): IccCurve | undefined {
  if (bytes.length < 12) throw new Error('ICC: truncated curve');
  const d = view(bytes),
    type = signature(bytes, 0);
  if (type === 'curv') {
    const n = d.getUint32(8);
    if (n > (bytes.length - 12) / 2) throw new Error('ICC: truncated curve table');
    if (n === 0)
      return curve(
        (x) => x,
        (x) => x,
      );
    if (n === 1) {
      const gamma = d.getUint16(12) / 256;
      return curve(
        (x) => Math.sign(x) * Math.abs(x) ** gamma,
        (x) => Math.sign(x) * Math.abs(x) ** (1 / gamma),
      );
    }
    return curve((x) => {
      const p = Math.min(1, Math.max(0, x)) * (n - 1),
        i = Math.min(n - 2, Math.floor(p)),
        t = p - i;
      return (d.getUint16(12 + 2 * i) * (1 - t) + d.getUint16(14 + 2 * i) * t) / 65535;
    });
  }
  if (type !== 'para') return undefined;
  const fn = d.getUint16(8),
    counts = [1, 3, 4, 5, 7],
    n = counts[fn];
  if (n === undefined) return undefined;
  if (bytes.length < 12 + n * 4) throw new Error('ICC: truncated parametric curve');
  const p = Array.from({ length: n }, (_, i) => fixed(d, 12 + i * 4));
  const [g, a = 1, b = 0, c = 0, threshold = 0, e = 0, f = 0] = p;
  return curve(
    (x) => {
      if (fn === 0) return Math.sign(x) * Math.abs(x) ** g!;
      if (fn === 1) return x >= -b / a ? (a * x + b) ** g! : 0;
      if (fn === 2) return x >= -b / a ? (a * x + b) ** g! + c : c;
      if (fn === 3) return x >= threshold ? (a * x + b) ** g! : c * x;
      return x >= threshold ? (a * x + b) ** g! + e : c * x + f;
    },
    (y) => {
      if (fn === 0) return Math.sign(y) * Math.abs(y) ** (1 / g!);
      if (fn === 1) return y > 0 ? (y ** (1 / g!) - b) / a : 0;
      if (fn === 2) return y > c ? ((y - c) ** (1 / g!) - b) / a : 0;
      const offset = fn === 4 ? e : 0;
      return y >= (a * threshold + b) ** g! + offset
        ? ((y - offset) ** (1 / g!) - b) / a
        : c === 0
          ? 0
          : (y - (fn === 4 ? f : 0)) / c;
    },
  );
}

/**
 * RGB matrix/TRC or gray TRC display profile to D50 XYZ PCS. A gray kTRC profile becomes a neutral RGB
 * transform (the same curve per channel, R = G = B mapped to Y times the D50 PCS white).
 * LUT-based and other colour spaces (CMYK, Lab, ...) deliberately return undefined.
 */
export function readIccRgbTransform(profile: IccProfile): IccRgbTransform | undefined {
  const space = signature(profile.header, 16);
  if ((space !== 'RGB ' && space !== 'GRAY') || signature(profile.header, 20) !== 'XYZ ') return undefined;
  if (profile.tags.some((t) => /^(A2B|B2A|D2B|B2D)/.test(t.signature))) return undefined;
  const tag = (s: string) => profile.tags.find((t) => t.signature === s)?.data;
  if (space === 'GRAY') {
    const b = tag('kTRC'),
      k = b && readIccCurve(b);
    if (!k) return undefined;
    // Neutral = D50 white from xy (0.34567, 0.3585), the white Bradford-adapted to D65 downstream; the
    // rounded ICC header illuminant (Z 0.8249) would tint gray by ~3e-4.
    return {
      matrix: [
        [0.34567 / 0.3585, 0, 0],
        [0, 1, 0],
        [0, 0, (1 - 0.34567 - 0.3585) / 0.3585],
      ],
      curves: [k, k, k],
    };
  }
  const xyz = ['rXYZ', 'gXYZ', 'bXYZ'].map((s) => {
    const b = tag(s);
    if (!b || b.length < 20 || signature(b, 0) !== 'XYZ ') return undefined;
    const d = view(b);
    return [fixed(d, 8), fixed(d, 12), fixed(d, 16)];
  });
  const curves = ['rTRC', 'gTRC', 'bTRC'].map((s) => {
    const b = tag(s);
    return b && readIccCurve(b);
  });
  if (xyz.some((v) => !v) || curves.some((v) => !v)) return undefined;
  // rXYZ/gXYZ/bXYZ are already adapted to the D50 PCS; applying chad again would double-adapt.
  return {
    matrix: [0, 1, 2].map((r) => xyz.map((v) => v![r]!)) as IccMatrix,
    curves: curves as IccRgbTransform['curves'],
  };
}
