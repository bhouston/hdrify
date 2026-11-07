/**
 * Restoration filters (ISO/IEC 18181-1 Annex J): Gaborish 3x3 smoothing and the
 * edge-preserving filter (EPF). Both use mirrored borders (spec Mirror()).
 * Ported from jxl-oxide jxl-render/filter (gabor.rs, epf.rs) and libjxl epf.cc.
 */

/** Spec Mirror(): reflects an out-of-range coordinate into `[0, n)` (-1 -> 0, n -> n-1). */
export function mirrorCoord(i: number, n: number): number {
  while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - 1 - i;
  return i;
}

/**
 * Gaborish on one `width x height` plane, in place:
 * `out = (c + w1 * sum(side) + w2 * sum(diag)) / (1 + 4 w1 + 4 w2)` with mirrored borders.
 */
export function applyGaborish(plane: Float32Array, width: number, height: number, w1: number, w2: number): void {
  const norm = 1 / (1 + 4 * w1 + 4 * w2);
  let prev = new Float32Array(width);
  let cur = new Float32Array(width);
  let next = new Float32Array(width);
  cur.set(plane.subarray(0, width));
  prev.set(cur);
  for (let y = 0; y < height; y++) {
    const ny = mirrorCoord(y + 1, height);
    next.set(ny === y ? cur : plane.subarray(ny * width, ny * width + width));
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const xl = x === 0 ? 0 : x - 1;
      const xr = x === width - 1 ? x : x + 1;
      const side = prev[x]! + next[x]! + cur[xl]! + cur[xr]!;
      const diag = prev[xl]! + prev[xr]! + next[xl]! + next[xr]!;
      plane[row + x] = (cur[x]! + w1 * side + w2 * diag) * norm;
    }
    const t = prev;
    prev = cur;
    cur = next;
    next = t;
  }
}

/** EPF parameters (RestorationFilter epf_* fields). */
export interface JxlEpfParams {
  /** 1..3 iterations (0 = disabled). */
  readonly iters: number;
  readonly channelScale: readonly number[];
  readonly pass0SigmaScale: number;
  readonly pass2SigmaScale: number;
  readonly borderSadMul: number;
}

/** Default EPF sharpness LUT (`i / 7`). */
export const JXL_DEFAULT_EPF_SHARP_LUT: readonly number[] = [0, 1 / 7, 2 / 7, 3 / 7, 4 / 7, 5 / 7, 6 / 7, 1];
/** Default epf_quant_mul. */
export const JXL_DEFAULT_EPF_QUANT_MUL = 0.46;

/** Per-8x8-block EPF sigma: `quantMul * 65536 / globalScale / hfMul * sharpLut[sharpness]`. */
export function epfSigma(
  globalScale: number,
  hfMul: number,
  sharpness: number,
  quantMul = JXL_DEFAULT_EPF_QUANT_MUL,
  sharpLut: readonly number[] = JXL_DEFAULT_EPF_SHARP_LUT,
): number {
  return ((quantMul * 65536) / globalScale / hfMul) * sharpLut[sharpness]!;
}

// [dx, dy] offsets.
const KERNEL_PLUS = [0, -1, 0, 1, -1, 0, 1, 0];
const KERNEL_DIAMOND = [0, -2, -1, -1, 0, -1, 1, -1, -2, 0, -1, 0, 1, 0, 2, 0, -1, 1, 0, 1, 1, 1, 0, 2];
const DIST_STEP0 = [0, -1, 1, 0, 0, 0, -1, 0, 0, 1];
const DIST_STEP1 = [0, -1, 0, 0, 0, 1, -1, 0, 1, 0];
const DIST_STEP2 = [0, 0];

function epfStep(
  step: number,
  src: readonly Float32Array[],
  dst: readonly Float32Array[],
  width: number,
  height: number,
  sigma: Float32Array,
  sigmaStride: number,
  p: JxlEpfParams,
): void {
  const kernel = step === 0 ? KERNEL_DIAMOND : KERNEL_PLUS;
  const dist = step === 0 ? DIST_STEP0 : step === 1 ? DIST_STEP1 : DIST_STEP2;
  const stepMul = step === 0 ? p.pass0SigmaScale : step === 2 ? p.pass2SigmaScale : 1;
  const borderMul = stepMul * p.borderSadMul;
  const cs0 = p.channelScale[0]!;
  const cs1 = p.channelScale[1]!;
  const cs2 = p.channelScale[2]!;
  const s0 = src[0]!,
    s1 = src[1]!,
    s2 = src[2]!;
  const d0 = dst[0]!,
    d1 = dst[1]!,
    d2 = dst[2]!;
  const negInvBase = 6.6 * (Math.SQRT1_2 - 1);
  const nTaps = kernel.length >> 1;
  const nDist = dist.length >> 1;
  // Linear offsets for the interior, where no mirroring can happen (reach = kernel 2 + SAD 1 = 3).
  const kOff = new Int32Array(nTaps);
  for (let t = 0; t < nTaps; t++) kOff[t] = kernel[2 * t + 1]! * width + kernel[2 * t]!;
  const dOff = new Int32Array(nDist);
  for (let d = 0; d < nDist; d++) dOff[d] = dist[2 * d + 1]! * width + dist[2 * d]!;
  // Centre SAD neighbour indices: independent of the kernel tap, so computed once per pixel.
  const bi = new Int32Array(nDist);
  for (let y = 0; y < height; y++) {
    const yBorder = (y & 7) === 0 || (y & 7) === 7;
    const yInterior = y >= 3 && y < height - 3;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const sg = sigma[(y >> 3) * sigmaStride + (x >> 3)]!;
      if (sg < 0.3) {
        d0[i] = s0[i]!;
        d1[i] = s1[i]!;
        d2[i] = s2[i]!;
        continue;
      }
      const sm = yBorder || (x & 7) === 0 || (x & 7) === 7 ? borderMul : stepMul;
      const negInvSigma = (negInvBase / sg) * sm;
      let sumW = 1;
      let a0 = s0[i]!,
        a1 = s1[i]!,
        a2 = s2[i]!;
      if (yInterior && x >= 3 && x < width - 3) {
        for (let t = 0; t < nTaps; t++) {
          const kc = i + kOff[t]!;
          let e0 = 0,
            e1 = 0,
            e2 = 0;
          for (let d = 0; d < nDist; d++) {
            const o = dOff[d]!;
            const ki = kc + o;
            const b = i + o;
            e0 += Math.abs(s0[ki]! - s0[b]!);
            e1 += Math.abs(s1[ki]! - s1[b]!);
            e2 += Math.abs(s2[ki]! - s2[b]!);
          }
          const w = Math.max(0, 1 + (cs0 * e0 + cs1 * e1 + cs2 * e2) * negInvSigma);
          if (w === 0) continue;
          sumW += w;
          a0 += w * s0[kc]!;
          a1 += w * s1[kc]!;
          a2 += w * s2[kc]!;
        }
      } else {
        for (let d = 0; d < nDist; d++) {
          bi[d] = mirrorCoord(y + dist[2 * d + 1]!, height) * width + mirrorCoord(x + dist[2 * d]!, width);
        }
        for (let k = 0; k < kernel.length; k += 2) {
          const kx = x + kernel[k]!;
          const ky = y + kernel[k + 1]!;
          let e0 = 0,
            e1 = 0,
            e2 = 0;
          for (let d = 0; d < nDist; d++) {
            const ki = mirrorCoord(ky + dist[2 * d + 1]!, height) * width + mirrorCoord(kx + dist[2 * d]!, width);
            const b = bi[d]!;
            e0 += Math.abs(s0[ki]! - s0[b]!);
            e1 += Math.abs(s1[ki]! - s1[b]!);
            e2 += Math.abs(s2[ki]! - s2[b]!);
          }
          const w = Math.max(0, 1 + (cs0 * e0 + cs1 * e1 + cs2 * e2) * negInvSigma);
          if (w === 0) continue;
          const ki = mirrorCoord(ky, height) * width + mirrorCoord(kx, width);
          sumW += w;
          a0 += w * s0[ki]!;
          a1 += w * s1[ki]!;
          a2 += w * s2[ki]!;
        }
      }
      d0[i] = a0 / sumW;
      d1[i] = a1 / sumW;
      d2[i] = a2 / sumW;
    }
  }
}

/**
 * Edge-preserving filter on three `width x height` planes, in place.
 * `sigma` holds one value per 8x8 block (`sigmaStride` = ceil(width / 8)); blocks
 * with sigma < 0.3 are left untouched. Runs step 0 only when `iters == 3`, step 1
 * always, step 2 when `iters >= 2` (libjxl epf.cc).
 */
export function applyEpf(
  planes: readonly Float32Array[],
  width: number,
  height: number,
  sigma: Float32Array,
  sigmaStride: number,
  params: JxlEpfParams,
): void {
  if (params.iters <= 0) return;
  const n = width * height;
  let src: Float32Array[] = planes.slice(0, 3);
  let dst: Float32Array[] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const steps = params.iters === 3 ? [0, 1, 2] : params.iters === 2 ? [1, 2] : [1];
  for (const step of steps) {
    epfStep(step, src, dst, width, height, sigma, sigmaStride, params);
    const t = src;
    src = dst;
    dst = t;
  }
  if (src[0] !== planes[0]) for (let c = 0; c < 3; c++) planes[c]!.set(src[c]!.subarray(0, n));
}
