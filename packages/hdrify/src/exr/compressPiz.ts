/**
 * PIZ compression for OpenEXR
 * PIZ uses: bitmap + LUT + 2D Haar wavelet + Huffman encoding
 * Block size: 32 scanlines (or fewer for last block)
 */

import { A_OFFSET, BITMAP_SIZE, INT16_SIZE, INT32_SIZE, MOD_MASK, USHORT_RANGE } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';
import { hufCompress } from './pizHuffman.js';

function UInt16(value: number): number {
  return value & 0xffff;
}

function Int16(value: number): number {
  const ref = UInt16(value);
  return ref > 0x7fff ? ref - 0x10000 : ref;
}

const wenc14Return = { l: 0, h: 0 };
const wenc16Return = { l: 0, h: 0 };

function wenc14(a: number, b: number): void {
  const as = Int16(a);
  const bs = Int16(b);
  const ms = (as + bs) >> 1;
  const ds = as - bs;
  wenc14Return.l = UInt16(ms);
  wenc14Return.h = UInt16(ds);
}

function wenc16(a: number, b: number): void {
  const ao = (a + A_OFFSET) & MOD_MASK;
  let m = (ao + b) >> 1;
  let d = ao - b;
  if (d < 0) m = (m + A_OFFSET) & MOD_MASK;
  d &= MOD_MASK;
  wenc16Return.l = UInt16(m);
  wenc16Return.h = UInt16(d);
}

/**
 * Build bitmap from uint16 data. bitmap[i>>3] |= 1<<(i&7) for each value.
 * Zero is implicit (bitmap[0] &= ~1).
 */
export function bitmapFromData(
  data: Uint16Array,
  nData: number,
  bitmap: Uint8Array,
  minNonZero: { value: number },
  maxNonZero: { value: number },
): void {
  for (let i = 0; i < BITMAP_SIZE; i++) bitmap[i] = 0;

  for (let i = 0; i < nData; i++) {
    const v = data[i];
    if (v !== undefined) {
      const bi = v >> 3;
      bitmap[bi] = (bitmap[bi] ?? 0) | (1 << (v & 7));
    }
  }

  bitmap[0] = (bitmap[0] ?? 0) & ~1;

  let mnnz = BITMAP_SIZE - 1;
  let mxnz = 0;
  for (let i = 0; i < BITMAP_SIZE; i++) {
    if (bitmap[i]) {
      if (mnnz > i) mnnz = i;
      if (mxnz < i) mxnz = i;
    }
  }
  minNonZero.value = mnnz;
  maxNonZero.value = mxnz;
}

/**
 * Build forward LUT: value -> compact index (0..n). Returns maxValue (n-1).
 */
export function forwardLutFromBitmap(bitmap: Uint8Array, lut: Uint16Array): number {
  let k = 0;
  for (let i = 0; i < USHORT_RANGE; i++) {
    if (i === 0 || (bitmap[i >> 3] ?? 0) & (1 << (i & 7))) {
      lut[i] = k++;
    } else {
      lut[i] = 0;
    }
  }
  return k - 1;
}

/**
 * Apply forward LUT: replace data values with compact indices.
 */
export function applyLutForward(lut: Uint16Array, data: Uint16Array, nData: number): void {
  for (let i = 0; i < nData; i++) {
    const v = data[i];
    if (v !== undefined) {
      const lv = lut[v];
      if (lv !== undefined) data[i] = lv;
    }
  }
}

/**
 * 2D Haar wavelet encode. Inverse of wav2Decode in decompressPiz.
 */
function wav2Encode(buffer: Uint16Array, j: number, nx: number, ox: number, ny: number, oy: number, mx: number): void {
  const w14 = mx < 1 << 14;
  const n = nx > ny ? ny : nx;
  let p = 1;
  let p2 = 2;

  while (p2 <= n) {
    let py = 0;
    const ey = py + oy * (ny - p2);
    const oy1 = oy * p;
    const oy2 = oy * p2;
    const ox1 = ox * p;
    const ox2 = ox * p2;
    let i00: number, i01: number, i10: number, i11: number;

    for (; py <= ey; py += oy2) {
      let px = py;
      const ex = py + ox * (nx - p2);

      for (; px <= ex; px += ox2) {
        const p01 = px + ox1;
        const p10 = px + oy1;
        const p11 = p10 + ox1;

        const pxJ = buffer[px + j];
        const p01J = buffer[p01 + j];
        const p10J = buffer[p10 + j];
        const p11J = buffer[p11 + j];
        if (pxJ === undefined || p01J === undefined || p10J === undefined || p11J === undefined) {
          continue;
        }

        if (w14) {
          wenc14(pxJ, p01J);
          i00 = wenc14Return.l;
          i01 = wenc14Return.h;
          wenc14(p10J, p11J);
          i10 = wenc14Return.l;
          i11 = wenc14Return.h;
          wenc14(i00, i10);
          buffer[px + j] = wenc14Return.l;
          buffer[p10 + j] = wenc14Return.h;
          wenc14(i01, i11);
          buffer[p01 + j] = wenc14Return.l;
          buffer[p11 + j] = wenc14Return.h;
        } else {
          wenc16(pxJ, p01J);
          i00 = wenc16Return.l;
          i01 = wenc16Return.h;
          wenc16(p10J, p11J);
          i10 = wenc16Return.l;
          i11 = wenc16Return.h;
          wenc16(i00, i10);
          buffer[px + j] = wenc16Return.l;
          buffer[p10 + j] = wenc16Return.h;
          wenc16(i01, i11);
          buffer[p01 + j] = wenc16Return.l;
          buffer[p11 + j] = wenc16Return.h;
        }
      }

      if (nx & p) {
        const p10 = px + oy1;
        const pxJ = buffer[px + j];
        const p10J = buffer[p10 + j];
        if (pxJ !== undefined && p10J !== undefined) {
          if (w14) wenc14(pxJ, p10J);
          else wenc16(pxJ, p10J);
          buffer[px + j] = w14 ? wenc14Return.l : wenc16Return.l;
          buffer[p10 + j] = w14 ? wenc14Return.h : wenc16Return.h;
        }
      }
    }

    if (ny & p) {
      let px = py;
      const ex = py + ox * (nx - p2);
      for (; px <= ex; px += ox2) {
        const p01 = px + ox1;
        const pxJ = buffer[px + j];
        const p01J = buffer[p01 + j];
        if (pxJ !== undefined && p01J !== undefined) {
          if (w14) wenc14(pxJ, p01J);
          else wenc16(pxJ, p01J);
          buffer[px + j] = w14 ? wenc14Return.l : wenc16Return.l;
          buffer[p01 + j] = w14 ? wenc14Return.h : wenc16Return.h;
        }
      }
    }

    p = p2;
    p2 <<= 1;
  }
}

/**
 * Rearrange scanline-interleaved half-float bytes to channel-planar uint16.
 * Input: [R0,G0,B0,A0, R1,G1,B1,A1, ...] per scanline
 * Output: [R0..R(n-1), G0..G(n-1), B0..B(n-1), A0..A(n-1)]
 */
function rearrangeToChannelPlanar(
  src: Uint8Array,
  width: number,
  blockHeight: number,
  channels: ExrChannel[],
): Uint16Array {
  const numChannels = channels.length;
  const pixelsPerChannel = width * blockHeight;
  const total = pixelsPerChannel * numChannels;
  const out = new Uint16Array(total);
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);

  const rIdx = channels.findIndex((ch) => ch.name === 'R' || ch.name === 'r');
  const gIdx = channels.findIndex((ch) => ch.name === 'G' || ch.name === 'g');
  const bIdx = channels.findIndex((ch) => ch.name === 'B' || ch.name === 'b');
  const aIdx = channels.findIndex((ch) => ch.name === 'A' || ch.name === 'a');

  for (let y = 0; y < blockHeight; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = y * width + x;
      const srcOffset = (y * width + x) * numChannels * INT16_SIZE;

      if (rIdx >= 0) out[rIdx * pixelsPerChannel + pixelIndex] = view.getUint16(srcOffset, true);
      if (gIdx >= 0) out[gIdx * pixelsPerChannel + pixelIndex] = view.getUint16(srcOffset + 2, true);
      if (bIdx >= 0) out[bIdx * pixelsPerChannel + pixelIndex] = view.getUint16(srcOffset + 4, true);
      if (aIdx >= 0) out[aIdx * pixelsPerChannel + pixelIndex] = view.getUint16(srcOffset + 6, true);
    }
  }
  return out;
}

/**
 * Compress half-float interleaved block using PIZ.
 * Input: rawHalfFloatInterleaved (scanline-interleaved bytes, R,G,B,A per pixel)
 */
export function compressPizBlock(
  rawHalfFloatInterleaved: Uint8Array,
  width: number,
  blockHeight: number,
  channels: ExrChannel[],
): Uint8Array {
  const numChannels = channels.length;
  const pixelsPerChannel = width * blockHeight;
  const totalPixels = pixelsPerChannel * numChannels;

  const planar = rearrangeToChannelPlanar(rawHalfFloatInterleaved, width, blockHeight, channels);

  const bitmap = new Uint8Array(BITMAP_SIZE);
  const minNonZero = { value: 0 };
  const maxNonZero = { value: 0 };
  bitmapFromData(planar, totalPixels, bitmap, minNonZero, maxNonZero);

  const lut = new Uint16Array(USHORT_RANGE);
  const maxValue = forwardLutFromBitmap(bitmap, lut);
  applyLutForward(lut, planar, totalPixels);

  for (let c = 0; c < numChannels; c++) {
    const channelOffset = c * pixelsPerChannel;
    wav2Encode(planar, channelOffset, width, 1, blockHeight, width, maxValue);
  }

  const hufCompressed = hufCompress(planar);

  const bitmapBytes = maxNonZero.value - minNonZero.value + 1;
  const result = new Uint8Array(2 + 2 + bitmapBytes + INT32_SIZE + hufCompressed.length);
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  view.setUint16(0, minNonZero.value, true);
  view.setUint16(2, maxNonZero.value, true);
  let offset = 4;
  if (minNonZero.value <= maxNonZero.value) {
    result.set(bitmap.subarray(minNonZero.value, maxNonZero.value + 1), offset);
    offset += bitmapBytes;
  }
  view.setUint32(offset, hufCompressed.length, true);
  offset += INT32_SIZE;
  result.set(hufCompressed, offset);

  return result;
}
