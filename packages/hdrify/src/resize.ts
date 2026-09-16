import type { HdrifyImage } from './hdrifyImage.js';

export const RESIZE_FILTERS = ['nearest', 'bilinear', 'lanczos'] as const;
export type ResizeFilter = (typeof RESIZE_FILTERS)[number];

export interface ResizeImageOptions {
  /** Target width in pixels */
  width: number;
  /** Target height in pixels */
  height: number;
  /** Resampling filter (default: lanczos) */
  filter?: ResizeFilter;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

const LANCZOS_A = 3;

function lanczosKernel(x: number): number {
  if (x <= -LANCZOS_A || x >= LANCZOS_A) return 0;
  return sinc(x) * sinc(x / LANCZOS_A);
}

function triangleKernel(x: number): number {
  const ax = Math.abs(x);
  return ax < 1 ? 1 - ax : 0;
}

interface Tap {
  index: number;
  weight: number;
}

/** For each destination sample, the clamped source indices and normalized weights that contribute to it. */
function computeTaps(srcSize: number, dstSize: number, filter: 'bilinear' | 'lanczos'): Tap[][] {
  const kernel = filter === 'lanczos' ? lanczosKernel : triangleKernel;
  const support = filter === 'lanczos' ? LANCZOS_A : 1;
  const scale = srcSize / dstSize;
  // When downsampling, widen the kernel to act as a low-pass filter and avoid aliasing.
  const filterScale = Math.max(scale, 1);
  const filterSupport = support * filterScale;

  const taps: Tap[][] = [];
  for (let dst = 0; dst < dstSize; dst++) {
    const center = (dst + 0.5) * scale - 0.5;
    const lo = Math.ceil(center - filterSupport);
    const hi = Math.floor(center + filterSupport);

    const contributions = new Map<number, number>();
    for (let src = lo; src <= hi; src++) {
      const weight = kernel((src - center) / filterScale);
      if (weight === 0) continue;
      const clamped = Math.min(srcSize - 1, Math.max(0, src));
      contributions.set(clamped, (contributions.get(clamped) ?? 0) + weight);
    }

    let sum = 0;
    for (const w of contributions.values()) sum += w;
    const pixelTaps: Tap[] = [];
    for (const [index, weight] of contributions) {
      pixelTaps.push({ index, weight: sum !== 0 ? weight / sum : 0 });
    }
    taps.push(pixelTaps);
  }
  return taps;
}

/** Resample along the horizontal axis using precomputed per-column taps. */
function resampleHorizontal(src: Float32Array, srcW: number, srcH: number, dstW: number, taps: Tap[][]): Float32Array {
  const dst = new Float32Array(dstW * srcH * 4);
  for (let y = 0; y < srcH; y++) {
    const rowOffset = y * srcW * 4;
    const dstRowOffset = y * dstW * 4;
    for (let x = 0; x < dstW; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const tap of taps[x]!) {
        const srcOffset = rowOffset + tap.index * 4;
        r += (src[srcOffset] ?? 0) * tap.weight;
        g += (src[srcOffset + 1] ?? 0) * tap.weight;
        b += (src[srcOffset + 2] ?? 0) * tap.weight;
        a += (src[srcOffset + 3] ?? 0) * tap.weight;
      }
      const dstOffset = dstRowOffset + x * 4;
      dst[dstOffset] = r;
      dst[dstOffset + 1] = g;
      dst[dstOffset + 2] = b;
      dst[dstOffset + 3] = a;
    }
  }
  return dst;
}

/** Resample along the vertical axis using precomputed per-row taps. */
function resampleVertical(src: Float32Array, srcW: number, dstH: number, taps: Tap[][]): Float32Array {
  const dst = new Float32Array(srcW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const dstRowOffset = y * srcW * 4;
    for (const tap of taps[y]!) {
      const srcRowOffset = tap.index * srcW * 4;
      for (let x = 0; x < srcW; x++) {
        const srcOffset = srcRowOffset + x * 4;
        const dstOffset = dstRowOffset + x * 4;
        dst[dstOffset] = (dst[dstOffset] ?? 0) + (src[srcOffset] ?? 0) * tap.weight;
        dst[dstOffset + 1] = (dst[dstOffset + 1] ?? 0) + (src[srcOffset + 1] ?? 0) * tap.weight;
        dst[dstOffset + 2] = (dst[dstOffset + 2] ?? 0) + (src[srcOffset + 2] ?? 0) * tap.weight;
        dst[dstOffset + 3] = (dst[dstOffset + 3] ?? 0) + (src[srcOffset + 3] ?? 0) * tap.weight;
      }
    }
  }
  return dst;
}

function resizeNearest(image: HdrifyImage, dstW: number, dstH: number): Float32Array {
  const { width: srcW, height: srcH, data: src } = image;
  const dst = new Float32Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(srcH - 1, Math.floor(((y + 0.5) * srcH) / dstH));
    const rowOffset = srcY * srcW * 4;
    const dstRowOffset = y * dstW * 4;
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(srcW - 1, Math.floor(((x + 0.5) * srcW) / dstW));
      const srcOffset = rowOffset + srcX * 4;
      const dstOffset = dstRowOffset + x * 4;
      dst[dstOffset] = src[srcOffset]!;
      dst[dstOffset + 1] = src[srcOffset + 1]!;
      dst[dstOffset + 2] = src[srcOffset + 2]!;
      dst[dstOffset + 3] = src[srcOffset + 3]!;
    }
  }
  return dst;
}

/**
 * Resize an HdrifyImage to the given dimensions, operating directly on the linear
 * float RGBA data (no gamma correction needed since resampling is done in linear space).
 */
export function resizeImage(image: HdrifyImage, options: ResizeImageOptions): HdrifyImage {
  const { width: srcW, height: srcH } = image;
  const filter = options.filter ?? 'lanczos';
  const { width: dstW, height: dstH } = options;

  if (!Number.isInteger(dstW) || !Number.isInteger(dstH) || dstW < 1 || dstH < 1) {
    throw new Error(`resizeImage: invalid target dimensions ${dstW}x${dstH}`);
  }

  let data: Float32Array;
  if (filter === 'nearest') {
    data = resizeNearest(image, dstW, dstH);
  } else if (dstW === srcW && dstH === srcH) {
    data = image.data.slice();
  } else {
    const horizontalTaps = computeTaps(srcW, dstW, filter);
    const verticalTaps = computeTaps(srcH, dstH, filter);
    const horizontal = resampleHorizontal(image.data, srcW, srcH, dstW, horizontalTaps);
    data = resampleVertical(horizontal, dstW, dstH, verticalTaps);
  }

  return {
    width: dstW,
    height: dstH,
    data,
    linearColorSpace: image.linearColorSpace,
    metadata: image.metadata,
  };
}
