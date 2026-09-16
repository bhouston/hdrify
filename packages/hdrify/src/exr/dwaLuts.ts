/**
 * DWAA/DWAB perceptual nonlinear <-> linear half-float LUTs.
 * See ImfDwaCompressor.cpp / dwaLookups.cpp: gamma 2.2 below 1.0, blended into a log
 * curve above 1.0, so DCT quantization spends its bits more perceptually uniformly.
 */

import { decodeFloat16, encodeFloat16 } from './halfFloat.js';

const LOG_BASE = Math.pow(Math.E, 2.2);

let linearLut: Uint16Array | null = null;

/** nonlinear-encoded half bits -> linear half bits */
export function getLinearLut(): Uint16Array {
  if (linearLut) return linearLut;
  const lut = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) {
    if (i === 0 || (i & 0x7c00) === 0x7c00) {
      lut[i] = 0;
      continue;
    }
    const f0 = decodeFloat16(i);
    const sign = f0 < 0 ? -1 : 1;
    const f = Math.abs(f0);
    const px = f <= 1 ? f : LOG_BASE;
    const py = f <= 1 ? 2.2 : f - 1;
    lut[i] = encodeFloat16(sign * Math.pow(px, py));
  }
  linearLut = lut;
  return lut;
}

let nonlinearLut: Uint16Array | null = null;

/** linear half bits -> nonlinear-encoded half bits */
export function getNonlinearLut(): Uint16Array {
  if (nonlinearLut) return nonlinearLut;
  const lut = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) {
    if (i === 0 || (i & 0x7c00) === 0x7c00) {
      lut[i] = 0;
      continue;
    }
    const f0 = decodeFloat16(i);
    const sign = f0 < 0 ? -1 : 1;
    const f = Math.abs(f0);
    const nonlinear = f <= 1 ? Math.pow(f, 1 / 2.2) : Math.log(f) / Math.log(LOG_BASE) + 1;
    lut[i] = encodeFloat16(sign * nonlinear);
  }
  nonlinearLut = lut;
  return lut;
}
