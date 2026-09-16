/**
 * B44/B44A core 4x4-block codec (OpenEXR internal_b44.c).
 * Packs 16 half-float samples (32 bytes) into 14 bytes, or 3 bytes for a
 * flat (constant-value) block when B44A's flat-field optimization applies.
 */

import { decodeFloat16, encodeFloat16 } from './halfFloat.js';

const BIAS = 0x20;

function shiftAndRound(x: number, shift: number): number {
  x <<= 1;
  const a = (1 << shift) - 1;
  shift += 1;
  const b = (x >> shift) & 1;
  return (x + a + b) >> shift;
}

// Lazily-built 64K-entry LUTs for B44's optional linear<->log conversion (gated by channel.pLinear).
let expTable: Uint16Array | undefined;
let logTable: Uint16Array | undefined;

function b44ConvertFromLinear(x: number): number {
  if ((x & 0x7c00) === 0x7c00) return 0; // infinity/nan
  if (x >= 0x558c && x < 0x8000) return 0x7bff; // >= 8 * log(HALF_MAX) -> HALF_MAX
  return encodeFloat16(Math.exp(decodeFloat16(x) / 8));
}

function b44ConvertToLinear(x: number): number {
  if ((x & 0x7c00) === 0x7c00) return 0; // infinity/nan
  if (x > 0x8000) return 0; // negative (excluding -0.0)
  return encodeFloat16(8 * Math.log(decodeFloat16(x)));
}

function ensureLinearTables(): void {
  if (expTable && logTable) return;
  expTable = new Uint16Array(65536);
  logTable = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) {
    expTable[i] = b44ConvertFromLinear(i);
    logTable[i] = b44ConvertToLinear(i);
  }
}

export function convertBlockFromLinear(s: Uint16Array): void {
  ensureLinearTables();
  for (let i = 0; i < 16; i++) s[i] = expTable![s[i]!]!;
}

export function convertBlockToLinear(s: Uint16Array): void {
  ensureLinearTables();
  for (let i = 0; i < 16; i++) s[i] = logTable![s[i]!]!;
}

/**
 * Pack a 4x4 block of 16 half-float bit patterns into `out` (a 14-byte buffer).
 * Returns the number of bytes written: 14, or 3 for a flat block (B44A only).
 */
export function packB44Block(s: Uint16Array, out: Uint8Array, flatFields: boolean, exactMax: boolean): number {
  const t = new Uint16Array(16);
  for (let i = 0; i < 16; i++) {
    const v = s[i]!;
    if ((v & 0x7c00) === 0x7c00) t[i] = 0x8000;
    else if (v & 0x8000) t[i] = ~v & 0xffff;
    else t[i] = v | 0x8000;
  }

  let tMax = 0;
  for (let i = 0; i < 16; i++) if (tMax < t[i]!) tMax = t[i]!;

  const d = new Int32Array(16);
  const r = new Int32Array(15);
  let shift = -1;
  let rMin = 0;
  let rMax = 0;

  do {
    shift += 1;
    for (let i = 0; i < 16; i++) d[i] = shiftAndRound(tMax - t[i]!, shift);

    r[0] = d[0]! - d[4]! + BIAS;
    r[1] = d[4]! - d[8]! + BIAS;
    r[2] = d[8]! - d[12]! + BIAS;

    r[3] = d[0]! - d[1]! + BIAS;
    r[4] = d[4]! - d[5]! + BIAS;
    r[5] = d[8]! - d[9]! + BIAS;
    r[6] = d[12]! - d[13]! + BIAS;

    r[7] = d[1]! - d[2]! + BIAS;
    r[8] = d[5]! - d[6]! + BIAS;
    r[9] = d[9]! - d[10]! + BIAS;
    r[10] = d[13]! - d[14]! + BIAS;

    r[11] = d[2]! - d[3]! + BIAS;
    r[12] = d[6]! - d[7]! + BIAS;
    r[13] = d[10]! - d[11]! + BIAS;
    r[14] = d[14]! - d[15]! + BIAS;

    rMin = r[0]!;
    rMax = r[0]!;
    for (let i = 1; i < 15; i++) {
      if (rMin > r[i]!) rMin = r[i]!;
      if (rMax < r[i]!) rMax = r[i]!;
    }
  } while (rMin < 0 || rMax > 0x3f);

  if (rMin === BIAS && rMax === BIAS && flatFields) {
    out[0] = t[0]! >> 8;
    out[1] = t[0]! & 0xff;
    out[2] = 0xfc;
    return 3;
  }

  if (exactMax) {
    t[0] = (tMax - ((d[0]! << shift) & 0xffff)) & 0xffff;
  }

  out[0] = t[0]! >> 8;
  out[1] = t[0]! & 0xff;
  out[2] = (shift << 2) | (r[0]! >> 4);
  out[3] = (r[0]! << 4) | (r[1]! >> 2);
  out[4] = (r[1]! << 6) | r[2]!;
  out[5] = (r[3]! << 2) | (r[4]! >> 4);
  out[6] = (r[4]! << 4) | (r[5]! >> 2);
  out[7] = (r[5]! << 6) | r[6]!;
  out[8] = (r[7]! << 2) | (r[8]! >> 4);
  out[9] = (r[8]! << 4) | (r[9]! >> 2);
  out[10] = (r[9]! << 6) | r[10]!;
  out[11] = (r[11]! << 2) | (r[12]! >> 4);
  out[12] = (r[12]! << 4) | (r[13]! >> 2);
  out[13] = (r[13]! << 6) | r[14]!;
  for (let i = 0; i < 14; i++) out[i] = out[i]! & 0xff;

  return 14;
}

function unmap(s: Uint16Array): void {
  for (let i = 0; i < 16; i++) {
    const v = s[i]!;
    s[i] = v & 0x8000 ? v & 0x7fff : ~v & 0xffff;
  }
}

/** Unpack a 14-byte B44 block into 16 half-float bit patterns. */
export function unpackB44Block14(b: Uint8Array, s: Uint16Array): void {
  s[0] = ((b[0]! << 8) | b[1]!) & 0xffff;

  const shift = b[2]! >> 2;
  const bias = (0x20 << shift) & 0xffff;

  s[4] = (s[0]! + ((((b[2]! << 4) | (b[3]! >> 4)) & 0x3f) << shift) - bias) & 0xffff;
  s[8] = (s[4]! + ((((b[3]! << 2) | (b[4]! >> 6)) & 0x3f) << shift) - bias) & 0xffff;
  s[12] = (s[8]! + ((b[4]! & 0x3f) << shift) - bias) & 0xffff;

  s[1] = (s[0]! + ((b[5]! >> 2) << shift) - bias) & 0xffff;
  s[5] = (s[4]! + ((((b[5]! << 4) | (b[6]! >> 4)) & 0x3f) << shift) - bias) & 0xffff;
  s[9] = (s[8]! + ((((b[6]! << 2) | (b[7]! >> 6)) & 0x3f) << shift) - bias) & 0xffff;
  s[13] = (s[12]! + ((b[7]! & 0x3f) << shift) - bias) & 0xffff;

  s[2] = (s[1]! + ((b[8]! >> 2) << shift) - bias) & 0xffff;
  s[6] = (s[5]! + ((((b[8]! << 4) | (b[9]! >> 4)) & 0x3f) << shift) - bias) & 0xffff;
  s[10] = (s[9]! + ((((b[9]! << 2) | (b[10]! >> 6)) & 0x3f) << shift) - bias) & 0xffff;
  s[14] = (s[13]! + ((b[10]! & 0x3f) << shift) - bias) & 0xffff;

  s[3] = (s[2]! + ((b[11]! >> 2) << shift) - bias) & 0xffff;
  s[7] = (s[6]! + ((((b[11]! << 4) | (b[12]! >> 4)) & 0x3f) << shift) - bias) & 0xffff;
  s[11] = (s[10]! + ((((b[12]! << 2) | (b[13]! >> 6)) & 0x3f) << shift) - bias) & 0xffff;
  s[15] = (s[14]! + ((b[13]! & 0x3f) << shift) - bias) & 0xffff;

  unmap(s);
}

/** Unpack a 3-byte flat B44A block into 16 identical half-float bit patterns. */
export function unpackB44Block3(b: Uint8Array, s: Uint16Array): void {
  const v = (b[0]! << 8) | b[1]!;
  s[0] = v & 0x8000 ? v & 0x7fff : ~v & 0xffff;
  for (let i = 1; i < 16; i++) s[i] = s[0]!;
}
