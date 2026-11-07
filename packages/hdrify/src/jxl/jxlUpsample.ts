/**
 * Non-separable 2x / 4x / 8x upsampling (ISO/IEC 18181-1 K.2) with the default
 * weights from libjxl image_metadata.cc. Each output pixel is a 5x5 weighted sum
 * of mirrored input samples, clamped to the 5x5 min/max.
 * Ported from jxl-oxide jxl-render/features/upsampling.rs.
 */

import { mirrorCoord } from './jxlRestoration.js';

/** Default up2_weight (15 values). */
export const JXL_DEFAULT_UP2_WEIGHTS: readonly number[] = [
  -0.017162, -0.03452303, -0.04022174, -0.02921014, -0.00624645, 0.14111091, 0.28896755, 0.00278718, -0.01610267,
  0.5666155, 0.03777607, -0.01986694, -0.03144731, -0.01185068, -0.00213539,
];

/** Default up4_weight (55 values). */
export const JXL_DEFAULT_UP4_WEIGHTS: readonly number[] = [
  -0.02419067, -0.03491987, -0.03693351, -0.03094285, -0.00529785, -0.01663432, -0.03556863, -0.03888905, -0.0351685,
  -0.00989469, 0.23651958, 0.33392945, -0.01073543, -0.01313181, -0.03556694, 0.13048175, 0.40103025, 0.0395115,
  -0.02077584, 0.46914198, -0.0020927, -0.01484589, -0.04064806, 0.1894253, 0.56279892, 0.066744, -0.02335494,
  -0.03551682, -0.0075483, -0.02267919, -0.02363578, 0.00315804, -0.03399098, -0.01359519, -0.00091653, -0.00335467,
  -0.01163294, -0.01610294, -0.00974088, -0.00191622, -0.01095446, -0.03198464, -0.04455121, -0.0279979, -0.00645912,
  0.06390599, 0.22963888, 0.00630981, -0.01897349, 0.67537268, 0.08483369, -0.02534994, -0.02205197, -0.01667999,
  -0.00384443,
];

/** Default up8_weight (210 values). */
export const JXL_DEFAULT_UP8_WEIGHTS: readonly number[] = [
  -0.02928613, -0.03706353, -0.03783812, -0.03324558, -0.00447632, -0.02519406, -0.03752601, -0.03901508, -0.03663285,
  -0.00646649, -0.02066407, -0.03838633, -0.04002101, -0.03900035, -0.00901973, -0.01626393, -0.03954148, -0.0404662,
  -0.03979621, -0.01224485, 0.29895328, 0.35757708, -0.02447552, -0.01081748, -0.04314594, 0.23903219, 0.41119301,
  -0.00573046, -0.01450239, -0.04246845, 0.17567618, 0.45220643, 0.02287757, -0.01936783, -0.03583255, 0.11572472,
  0.47416733, 0.0628444, -0.02685066, 0.4272005, -0.02248939, -0.01155273, -0.04562755, 0.28689496, 0.49093869,
  -0.00007891, -0.01545926, -0.04562659, 0.2123892, 0.53980934, 0.03369474, -0.02070211, -0.03866988, 0.1422955,
  0.56593398, 0.08045181, -0.02888298, -0.03680918, -0.00542229, -0.02920477, -0.02788574, -0.0211818, -0.03942402,
  -0.00775547, -0.02433614, -0.03193943, -0.02030828, -0.04044014, -0.01074016, -0.01930822, -0.03620399, -0.01974125,
  -0.03919545, -0.01456093, -0.00045072, -0.0036011, -0.01020207, -0.01231907, -0.00638988, -0.00071592, -0.00279122,
  -0.00957115, -0.01288327, -0.00730937, -0.00107783, -0.00210156, -0.00890705, -0.01317668, -0.00813895, -0.00153491,
  -0.02128481, -0.04173044, -0.04831487, -0.0329319, -0.0052526, -0.01720322, -0.04052736, -0.05045706, -0.03607317,
  -0.0073803, -0.01341764, -0.03965629, -0.05151616, -0.03814886, -0.01005819, 0.18968273, 0.33063684, -0.01300105,
  -0.0137295, -0.04017465, 0.13727832, 0.36402234, 0.0102789, -0.01832107, -0.03365072, 0.08734506, 0.38194295,
  0.04338228, -0.02525993, 0.56408126, 0.00458352, -0.01648227, -0.04887868, 0.24585519, 0.62026135, 0.04314807,
  -0.02213737, -0.04158014, 0.16637289, 0.65027023, 0.09621636, -0.03101388, -0.04082742, -0.00904519, -0.02790922,
  -0.02117818, 0.00798662, -0.03995711, -0.01243427, -0.02231705, -0.02946266, 0.00992055, -0.03600283, -0.0168492,
  -0.00111684, -0.00411204, -0.0129713, -0.01723725, -0.01022545, -0.00165306, -0.0031311, -0.01218016, -0.01763266,
  -0.0112562, -0.00231663, -0.01374149, -0.0379762, -0.05142937, -0.03117307, -0.00581914, -0.01064003, -0.03608089,
  -0.05272168, -0.0337567, -0.00795586, 0.09628104, 0.27129991, -0.00353779, -0.01734151, -0.03153981, 0.0568623,
  0.28500998, 0.02230594, -0.02374955, 0.68214326, 0.05018048, -0.02320852, -0.04383616, 0.18459474, 0.71517975,
  0.10805613, -0.03263677, -0.03637639, -0.01394373, -0.02511203, -0.01728636, 0.05407331, -0.02867568, -0.01893131,
  -0.00240854, -0.00446511, -0.01636187, -0.02377053, -0.01522848, -0.00333334, -0.00819975, -0.02964169, -0.04499287,
  -0.0274535, -0.00612408, 0.02727416, 0.194466, 0.00159832, -0.02232473, 0.74982506, 0.1145262, -0.03348048,
  -0.01605681, -0.02070339, -0.00458223,
];

/**
 * Expands the packed upper-triangular weights into `(k/2)^2` 5x5 kernels for the
 * top-left quadrant of a `k x k` output cell: `kernels[(my * k/2 + mx) * 25 + ky * 5 + kx]`.
 */
export function expandUpsampleKernels(k: number, weights: readonly number[]): Float32Array {
  const n = k >> 1;
  const out = new Float32Array(n * n * 25);
  let wi = 0;
  for (let y = 0; y < 5 * n; y++) {
    for (let x = y; x < 5 * n; x++) {
      const w = weights[wi++]!;
      const my = Math.floor(y / 5),
        ky = y % 5,
        mx = Math.floor(x / 5),
        kx = x % 5;
      out[(my * n + mx) * 25 + ky * 5 + kx] = w;
      out[(mx * n + my) * 25 + kx * 5 + ky] = w;
    }
  }
  return out;
}

/**
 * Upsamples one plane by `k` (2, 4 or 8). Returns a new `(width*k) x (height*k)` plane.
 * `weights` defaults to the libjxl defaults for `k`.
 */
export function upsamplePlane(
  plane: Float32Array,
  width: number,
  height: number,
  k: 2 | 4 | 8,
  weights?: readonly number[],
): Float32Array {
  const w =
    weights ?? (k === 2 ? JXL_DEFAULT_UP2_WEIGHTS : k === 4 ? JXL_DEFAULT_UP4_WEIGHTS : JXL_DEFAULT_UP8_WEIGHTS);
  const kernels = expandUpsampleKernels(k, w);
  const n = k >> 1;
  const ow = width * k;
  const oh = height * k;
  const out = new Float32Array(ow * oh);
  // Flipped kernel per output sub-pixel, built once: full[(dy * k + dx) * 25 + iy * 5 + ix].
  const full = new Float32Array(k * k * 25);
  for (let dy = 0; dy < k; dy++) {
    const flipV = dy >= n;
    const my = flipV ? k - 1 - dy : dy;
    for (let dx = 0; dx < k; dx++) {
      const flipH = dx >= n;
      const kb = (my * n + (flipH ? k - 1 - dx : dx)) * 25;
      const fb = (dy * k + dx) * 25;
      for (let iy = 0; iy < 5; iy++) {
        const kyy = (flipV ? 4 - iy : iy) * 5;
        for (let ix = 0; ix < 5; ix++) full[fb + iy * 5 + ix] = kernels[kb + kyy + (flipH ? 4 - ix : ix)]!;
      }
    }
  }
  // Mirrored coordinate tables for the 2-sample reach on each side.
  const colIdx = new Int32Array(width + 4);
  for (let x = 0; x < colIdx.length; x++) colIdx[x] = mirrorCoord(x - 2, width);
  const rowIdx = new Int32Array(height + 4);
  for (let y = 0; y < rowIdx.length; y++) rowIdx[y] = mirrorCoord(y - 2, height) * width;
  // 5x5 neighbourhood of the current source pixel (mirrored), reloaded per source pixel.
  const nb = new Float32Array(25);
  for (let sy = 0; sy < height; sy++) {
    for (let sx = 0; sx < width; sx++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let iy = 0; iy < 5; iy++) {
        const row = rowIdx[sy + iy]!;
        for (let ix = 0; ix < 5; ix++) {
          const v = plane[row + colIdx[sx + ix]!]!;
          nb[iy * 5 + ix] = v;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      for (let dy = 0; dy < k; dy++) {
        const orow = (sy * k + dy) * ow + sx * k;
        for (let dx = 0; dx < k; dx++) {
          const fb = (dy * k + dx) * 25;
          let sum = 0;
          for (let j = 0; j < 25; j++) sum += full[fb + j]! * nb[j]!;
          out[orow + dx] = sum < lo ? lo : sum > hi ? hi : sum;
        }
      }
    }
  }
  return out;
}
