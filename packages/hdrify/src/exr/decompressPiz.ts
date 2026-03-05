/**
 * PIZ decompression for OpenEXR
 * PIZ compression uses blocks of 32 scanlines (or fewer for the last block)
 * Supports both 16-bit half and 32-bit float channel data (OpenEXR stores 32-bit as two u16 halves).
 */

import {
  A_OFFSET,
  BITMAP_SIZE,
  FLOAT,
  FLOAT32_SIZE,
  INT8_SIZE,
  INT16_SIZE,
  INT32_SIZE,
  MOD_MASK,
  USHORT_RANGE,
} from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';
import { hufUncompress } from './pizHuffman.js';

function getBytesPerChannel(pixelType: number): number {
  if (pixelType === FLOAT) return FLOAT32_SIZE;
  return INT16_SIZE; // HALF or other
}

function UInt16(value: number): number {
  return value & 0xffff;
}

function Int16(value: number): number {
  const ref = UInt16(value);
  return ref > 0x7fff ? ref - 0x10000 : ref;
}

const wdec14Return = { a: 0, b: 0 };
const wdec16Return = { a: 0, b: 0 };

function wdec14(l: number, h: number): void {
  const ls = Int16(l);
  const hs = Int16(h);
  const hi = hs;
  const ai = ls + (hi & 1) + (hi >> 1);
  wdec14Return.a = ai;
  wdec14Return.b = ai - hi;
}

function wdec16(l: number, h: number): void {
  const m = UInt16(l);
  const d = UInt16(h);
  const bb = (m - (d >> 1)) & MOD_MASK;
  const aa = (d + bb - A_OFFSET) & MOD_MASK;
  wdec16Return.a = aa;
  wdec16Return.b = bb;
}

function reverseLutFromBitmap(bitmap: Uint8Array, lut: Uint16Array): number {
  let k = 0;
  for (let i = 0; i < USHORT_RANGE; ++i) {
    const bitmapIndex = i >> 3;
    const bitmapValue = bitmap[bitmapIndex];
    if (bitmapValue === undefined) {
      break;
    }
    if (i === 0 || bitmapValue & (1 << (i & 7))) {
      lut[k++] = i;
    }
  }
  const n = k - 1;
  while (k < USHORT_RANGE) {
    lut[k++] = 0;
  }
  return n;
}

function applyLut(lut: Uint16Array, data: Uint16Array, nData: number): void {
  for (let i = 0; i < nData; ++i) {
    const dataValue = data[i];
    if (dataValue !== undefined) {
      const lutValue = lut[dataValue];
      if (lutValue !== undefined) {
        data[i] = lutValue;
      }
    }
  }
}

function wav2Decode(buffer: Uint16Array, j: number, nx: number, ox: number, ny: number, oy: number, mx: number): void {
  const w14 = mx < 1 << 14;
  const n = nx > ny ? ny : nx;
  let p = 1;
  let p2: number;
  let py = 0;

  while (p <= n) p <<= 1;
  p >>= 1;
  p2 = p;
  p >>= 1;

  while (p >= 1) {
    py = 0;
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
        const p10J = buffer[p10 + j];
        const p01J = buffer[p01 + j];
        const p11J = buffer[p11 + j];
        if (pxJ === undefined || p10J === undefined || p01J === undefined || p11J === undefined) {
          continue;
        }

        if (w14) {
          wdec14(pxJ, p10J);
          i00 = wdec14Return.a;
          i10 = wdec14Return.b;

          wdec14(p01J, p11J);
          i01 = wdec14Return.a;
          i11 = wdec14Return.b;

          wdec14(i00, i01);
          buffer[px + j] = wdec14Return.a;
          buffer[p01 + j] = wdec14Return.b;

          wdec14(i10, i11);
          buffer[p10 + j] = wdec14Return.a;
          buffer[p11 + j] = wdec14Return.b;
        } else {
          wdec16(pxJ, p10J);
          i00 = wdec16Return.a;
          i10 = wdec16Return.b;

          wdec16(p01J, p11J);
          i01 = wdec16Return.a;
          i11 = wdec16Return.b;

          wdec16(i00, i01);
          buffer[px + j] = wdec16Return.a;
          buffer[p01 + j] = wdec16Return.b;

          wdec16(i10, i11);
          buffer[p10 + j] = wdec16Return.a;
          buffer[p11 + j] = wdec16Return.b;
        }
      }

      if (nx & p) {
        const p10 = px + oy1;
        const pxJ = buffer[px + j];
        const p10J = buffer[p10 + j];
        if (pxJ !== undefined && p10J !== undefined) {
          if (w14) wdec14(pxJ, p10J);
          else wdec16(pxJ, p10J);
          i00 = w14 ? wdec14Return.a : wdec16Return.a;
          buffer[p10 + j] = w14 ? wdec14Return.b : wdec16Return.b;
          buffer[px + j] = i00;
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
          if (w14) wdec14(pxJ, p01J);
          else wdec16(pxJ, p01J);
          i00 = w14 ? wdec14Return.a : wdec16Return.a;
          buffer[p01 + j] = w14 ? wdec14Return.b : wdec16Return.b;
          buffer[px + j] = i00;
        }
      }
    }

    p2 = p;
    p >>= 1;
  }
}

/**
 * Decompress PIZ-compressed scanline block data
 */
export function decompressPiz(
  compressedData: Uint8Array,
  width: number,
  channels: ExrChannel[],
  _dataSize: number,
  blockHeight: number = 32,
): Uint8Array {
  const dataView = new DataView(compressedData.buffer, compressedData.byteOffset, compressedData.byteLength);
  let offset = 0;

  // Read min/max non-zero values
  const minNonZero = dataView.getUint16(offset, true);
  offset += INT16_SIZE;
  const maxNonZero = dataView.getUint16(offset, true);
  offset += INT16_SIZE;

  if (maxNonZero >= BITMAP_SIZE) {
    throw new Error('Invalid PIZ data: maxNonZero out of range');
  }

  // Read bitmap - stored as individual bytes, not bit-packed
  // Read maxNonZero - minNonZero + 1 bytes and store them at positions [i + minNonZero]
  const bitmap = new Uint8Array(BITMAP_SIZE);
  if (minNonZero <= maxNonZero) {
    for (let i = 0; i < maxNonZero - minNonZero + 1; i++) {
      const byte = dataView.getUint8(offset);
      offset += INT8_SIZE;
      bitmap[i + minNonZero] = byte;
    }
  }

  // Build reverse LUT
  const lut = new Uint16Array(USHORT_RANGE);
  const n = reverseLutFromBitmap(bitmap, lut);

  // Read compressed data size (stored as uint32 after bitmap)
  if (offset + INT32_SIZE > compressedData.length) {
    throw new Error(`Invalid PIZ data: not enough data for compressed size at offset ${offset}`);
  }
  const compressedSize = dataView.getUint32(offset, true);
  offset += INT32_SIZE;

  // Validate compressed size
  if (compressedSize <= 0 || compressedSize > compressedData.length - offset) {
    throw new Error(
      `Invalid PIZ compressed size: ${compressedSize}, available: ${compressedData.length - offset}, offset: ${offset}, total length: ${compressedData.length}`,
    );
  }

  // Read compressed data - it starts right after the bitmap
  const compressedBuffer = new Uint8Array(compressedData.buffer, compressedData.byteOffset + offset, compressedSize);

  const numChannels = channels.length;
  const primaryChannel = channels[0];
  if (!primaryChannel) {
    throw new Error('Invalid PIZ data: no channels');
  }
  const bytesPerChannel = getBytesPerChannel(primaryChannel.pixelType);
  const u16sPerChannelValue = bytesPerChannel / INT16_SIZE; // 1 for HALF, 2 for FLOAT
  const pixelsPerChannel = width * blockHeight;
  const u16sPerChannel = pixelsPerChannel * u16sPerChannelValue;
  const totalU16 = numChannels * u16sPerChannel;
  const outputBuffer = new Uint16Array(totalU16);

  hufUncompress(compressedBuffer, new DataView(compressedBuffer.buffer, compressedBuffer.byteOffset, compressedBuffer.byteLength), { value: 0 }, compressedSize, outputBuffer, totalU16);

  for (let c = 0; c < numChannels; c++) {
    const channelOffset = c * u16sPerChannel;
    if (u16sPerChannelValue === 1) {
      wav2Decode(outputBuffer, channelOffset, width, 1, blockHeight, width, n);
    } else {
      // 32-bit float: two u16 halves per value, decode low and high planes with stride 2
      wav2Decode(outputBuffer, channelOffset, width, 2, blockHeight, width * 2, n);
      wav2Decode(outputBuffer, channelOffset + 1, width, 2, blockHeight, width * 2, n);
    }
  }

  applyLut(lut, outputBuffer, totalU16);

  const resultSize = width * blockHeight * numChannels * bytesPerChannel;
  const result = new Uint8Array(resultSize);
  const resultView = new DataView(result.buffer, result.byteOffset, result.byteLength);

  for (let y = 0; y < blockHeight; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = y * width + x;
      const resultPixelOffset = (y * width + x) * numChannels * bytesPerChannel;
      for (let c = 0; c < numChannels; c++) {
        const base = c * u16sPerChannel + pixelIndex * u16sPerChannelValue;
        if (bytesPerChannel === INT16_SIZE) {
          const value = outputBuffer[base];
          if (value !== undefined) {
            resultView.setUint16(resultPixelOffset + c * INT16_SIZE, value, true);
          }
        } else {
          const lo = outputBuffer[base];
          const hi = outputBuffer[base + 1];
          if (lo !== undefined && hi !== undefined) {
            const bits = (hi << 16) | lo;
            resultView.setUint32(resultPixelOffset + c * FLOAT32_SIZE, bits, true);
          }
        }
      }
    }
  }

  return result;
}
