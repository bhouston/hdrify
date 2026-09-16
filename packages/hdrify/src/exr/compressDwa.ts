/**
 * DWAA/DWAB compression for OpenEXR.
 * Inverse of decompressDwa.ts: per-channel classification into lossy-DCT (CSC-grouped RGB
 * or single channel), RLE (e.g. alpha), or UNKNOWN (zlib) groups; forward 709 CSC; 8x8
 * forward DCT; zig-zag + zero-run RLE of AC coefficients, Huffman-compressed; DC stream
 * zip-predictor compressed (same pipeline as ZIP channel data).
 *
 * Unlike the reference encoder, this skips the "fewest-bits-set" quantization search
 * (a size optimization - see ImfDwaCompressor.cpp) and stores DCT coefficients rounded
 * to the nearest half float. The wire format has no dequantization step either way, so
 * this is simply the dwaCompressionLevel=0 (no extra quantization) case: fully decodable
 * by decompressDwa and by the reference OpenEXR decoder, just less aggressively compressed.
 */

import { zlibSync } from 'fflate';
import { compressRLE } from './compressRle.js';
import { channelByteSize, ZIGZAG } from './decompressDwa.js';
import { computeDwaChannelGroups } from './dwaClassify.js';
import { getNonlinearLut } from './dwaLuts.js';
import { applyExrPredictorEncode, reorderForWriting } from './exrDspWrite.js';
import { FLOAT, ULONG_SIZE } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';
import { decodeFloat16, encodeFloat16 } from './halfFloat.js';
import { hufCompress } from './pizHuffman.js';

// Forward 709 CSC, R'G'B' -> Y'CbCr (exact inverse of csc709Inverse64 in decompressDwa.ts).
function csc709Forward64(r: Float64Array, g: Float64Array, b: Float64Array): void {
  for (let i = 0; i < 64; i++) {
    const rr = r[i]!;
    const gg = g[i]!;
    const bb = b[i]!;
    r[i] = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
    g[i] = -0.1146 * rr - 0.3854 * gg + 0.5 * bb;
    b[i] = 0.5 * rr - 0.4542 * gg - 0.0458 * bb;
  }
}

// Forward 8x8 DCT-II, orthonormal, in place. Exact mathematical inverse of idct8x8 in
// decompressDwa.ts (verified by round-trip: brute-force O(N^2) per dimension is plenty
// fast for 8x8 blocks, no need for a fast butterfly form).
function fdct1d(src: Float64Array, dst: Float64Array, srcStride: number, dstStride: number, offset: number): void {
  for (let u = 0; u < 8; u++) {
    let sum = 0;
    for (let n = 0; n < 8; n++) {
      sum += src[offset + n * srcStride]! * Math.cos(((2 * n + 1) * u * Math.PI) / 16);
    }
    const alpha = u === 0 ? Math.SQRT1_2 : 1;
    dst[offset + u * dstStride] = 0.5 * alpha * sum;
  }
}

function fdct8x8(data: Float64Array): void {
  const tmp = new Float64Array(64);
  for (let row = 0; row < 8; row++) fdct1d(data, tmp, 1, 1, row * 8);
  const tmp2 = new Float64Array(64);
  for (let col = 0; col < 8; col++) fdct1d(tmp, tmp2, 8, 8, col);
  data.set(tmp2);
}

// dst is indexed by zig-zag position (matches decompressDwa.ts's fromHalfZigZag, which
// reads dst[normalOrderIndex] = decode(src[ZIGZAG[normalOrderIndex]])).
function toHalfZigZag(src: Float64Array, dst: Uint16Array): void {
  for (let i = 0; i < 64; i++) {
    dst[ZIGZAG[i]!] = encodeFloat16(src[i]!);
  }
}

// Zero-run RLE of the AC coefficients (indices 1..63). Mirrors LossyDctEncoder_rleAc:
// 0xff00 signals "rest of block is zero" (EOB), 0xff00|len signals a run of len zeros,
// anything else is a literal coefficient.
function rleAc(halfZig: Uint16Array, out: number[]): void {
  let dctComp = 1;
  while (dctComp < 64) {
    const v = halfZig[dctComp]!;
    if (v !== 0) {
      out.push(v);
      dctComp++;
      continue;
    }
    let runLen = 1;
    while (dctComp + runLen < 64 && halfZig[dctComp + runLen] === 0) runLen++;
    if (runLen === 1) {
      out.push(v);
    } else if (dctComp + runLen === 64) {
      out.push(0xff00);
    } else {
      out.push(0xff00 | runLen);
    }
    dctComp += runLen;
  }
}

function encodeLossyDctGroup(
  compIdx: number[],
  width: number,
  height: number,
  channelIn: Uint8Array[],
  channels: ExrChannel[],
  dcOut: number[],
  acOut: number[],
  forceNonlinear: boolean,
): void {
  const numComp = compIdx.length;
  const numBlocksX = Math.ceil(width / 8);
  const numBlocksY = Math.ceil(height / 8);

  const lut = forceNonlinear ? getNonlinearLut() : null;

  // Read each channel's plane as raw half-float bits, converting FLOAT source data to
  // half first (matches the reference encoder's XDR FLOAT -> HALF quantization pass).
  const halfPlanes: Uint16Array[] = compIdx.map((ci) => {
    const channel = channels[ci]!;
    const src = channelIn[ci]!;
    const n = width * height;
    const plane = new Uint16Array(n);
    if (channel.pixelType === FLOAT) {
      const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
      for (let i = 0; i < n; i++) {
        let f = dv.getFloat32(i * 4, true);
        if (f > 65504) f = 65504;
        else if (f < -65504) f = -65504;
        plane[i] = encodeFloat16(f);
      }
    } else {
      const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
      for (let i = 0; i < n; i++) plane[i] = dv.getUint16(i * 2, true);
    }
    return plane;
  });

  const dctData: Float64Array[] = Array.from({ length: numComp }, () => new Float64Array(64));
  const halfZig: Uint16Array[] = Array.from({ length: numComp }, () => new Uint16Array(64));
  const dcPerChannel: number[][] = Array.from({ length: numComp }, () => []);

  for (let blocky = 0; blocky < numBlocksY; blocky++) {
    for (let blockx = 0; blockx < numBlocksX; blockx++) {
      for (let c = 0; c < numComp; c++) {
        const plane = halfPlanes[c]!;
        const dd = dctData[c]!;
        for (let y = 0; y < 8; y++) {
          let vy = blocky * 8 + y;
          if (vy >= height) vy = height - (vy - (height - 1));
          for (let x = 0; x < 8; x++) {
            let vx = blockx * 8 + x;
            if (vx >= width) vx = width - (vx - (width - 1));
            let h = plane[vy * width + vx]!;
            if (lut) h = lut[h]!;
            dd[y * 8 + x] = decodeFloat16(h);
          }
        }
      }

      if (numComp === 3) {
        csc709Forward64(dctData[0]!, dctData[1]!, dctData[2]!);
      }

      for (let c = 0; c < numComp; c++) {
        const dd = dctData[c]!;
        fdct8x8(dd);
        const hz = halfZig[c]!;
        toHalfZigZag(dd, hz);
        dcPerChannel[c]!.push(hz[0]!);
        rleAc(hz, acOut);
      }
    }
  }

  for (const dc of dcPerChannel) dcOut.push(...dc);
}

function writeU64(dv: DataView, offset: number, value: number): void {
  dv.setBigUint64(offset, BigInt(value), true);
}

/**
 * Compress a scanline block using DWAA/DWAB. Input/output conventions match
 * compressPxr24Block/compressZipBlock: raw scanline-major, channel-major-per-scanline
 * bytes in, self-contained compressed chunk out (no y/dataSize prefix - that's added by
 * writeExrScanBlock).
 */
export function compressDwaBlock(
  rawInterleaved: Uint8Array,
  width: number,
  blockHeight: number,
  channels: ExrChannel[],
): Uint8Array {
  const legacy = false; // always write version 2 (current format)
  const bpeArr = channels.map((ch) => channelByteSize(ch.pixelType));

  // Split scanline-major/channel-major-per-scanline input into channel-planar, line-major
  // arrays (inverse of decompressDwa's final assembly step).
  const channelIn: Uint8Array[] = channels.map((_, i) => new Uint8Array(width * blockHeight * bpeArr[i]!));
  let readOffset = 0;
  for (let y = 0; y < blockHeight; y++) {
    for (let c = 0; c < channels.length; c++) {
      const bpe = bpeArr[c]!;
      const rowBytes = width * bpe;
      channelIn[c]!.set(rawInterleaved.subarray(readOffset, readOffset + rowBytes), y * rowBytes);
      readOffset += rowBytes;
    }
  }

  const { classes, cscGroups, grouped } = computeDwaChannelGroups(channels, legacy);

  const dcValues: number[] = [];
  const acValues: number[] = [];

  for (const group of cscGroups) {
    encodeLossyDctGroup(group, width, blockHeight, channelIn, channels, dcValues, acValues, true);
  }

  const unknownParts: Uint8Array[] = [];
  const rleParts: Uint8Array[] = [];

  for (let i = 0; i < channels.length; i++) {
    if (grouped.has(i)) continue;
    const cls = classes[i]!;
    const channel = channels[i]!;

    if (cls.scheme === 'DCT') {
      encodeLossyDctGroup([i], width, blockHeight, channelIn, channels, dcValues, acValues, !channel.pLinear);
    } else if (cls.scheme === 'RLE') {
      const bpe = bpeArr[i]!;
      const planeSize = width * blockHeight;
      const src = channelIn[i]!;
      const chanSlice = new Uint8Array(bpe * planeSize);
      for (let p = 0; p < planeSize; p++) {
        for (let b = 0; b < bpe; b++) {
          chanSlice[b * planeSize + p] = src[p * bpe + b]!;
        }
      }
      rleParts.push(chanSlice);
    } else {
      unknownParts.push(channelIn[i]!);
    }
  }

  // AC stream: static-Huffman compressed (acCompression = 0), same coder used by PIZ.
  const acRaw = new Uint16Array(acValues);
  const acBuf = acRaw.length > 0 ? hufCompress(acRaw) : new Uint8Array(0);

  // DC stream: zip-predictor compressed, same pipeline as ZIP channel data.
  const totalDcCount = dcValues.length;
  let dcBuf: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  if (totalDcCount > 0) {
    const dcInterleaved = new Uint8Array(totalDcCount * 2);
    const dcDv = new DataView(dcInterleaved.buffer);
    for (let i = 0; i < totalDcCount; i++) dcDv.setUint16(i * 2, dcValues[i]!, true);
    const dcPlanar = new Uint8Array(dcInterleaved.length);
    reorderForWriting(dcPlanar, dcInterleaved);
    applyExrPredictorEncode(dcPlanar);
    dcBuf = zlibSync(dcPlanar, { level: 4 });
  }

  // RLE stream: OpenEXR RLE, then zlib (no predictor - matches decompressDwa's RLE path).
  let rleUncompressed: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let rleRawSize = 0;
  for (const part of rleParts) rleRawSize += part.length;
  let rleBuf: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  if (rleRawSize > 0) {
    const rleRaw = new Uint8Array(rleRawSize);
    let off = 0;
    for (const part of rleParts) {
      rleRaw.set(part, off);
      off += part.length;
    }
    rleUncompressed = compressRLE(rleRaw);
    rleBuf = zlibSync(rleUncompressed, { level: 4 });
  }

  // Unknown stream: raw bytes, zlib compressed (matches decompressDwa's unknown path).
  let unknownUncompressedSize = 0;
  for (const part of unknownParts) unknownUncompressedSize += part.length;
  let unknownBuf: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  if (unknownUncompressedSize > 0) {
    const unknownRaw = new Uint8Array(unknownUncompressedSize);
    let off = 0;
    for (const part of unknownParts) {
      unknownRaw.set(part, off);
      off += part.length;
    }
    unknownBuf = zlibSync(unknownRaw, { level: 4 });
  }

  const HEADER_FIELDS = 11;
  const headerSize = HEADER_FIELDS * ULONG_SIZE;
  const ruleSize = 2; // no per-channel rule overrides needed: all channels match default rules
  const totalSize = headerSize + ruleSize + unknownBuf.length + acBuf.length + dcBuf.length + rleBuf.length;

  const result = new Uint8Array(totalSize);
  const dv = new DataView(result.buffer);
  writeU64(dv, 0, 2); // version
  writeU64(dv, 1 * ULONG_SIZE, unknownUncompressedSize);
  writeU64(dv, 2 * ULONG_SIZE, unknownBuf.length);
  writeU64(dv, 3 * ULONG_SIZE, acBuf.length);
  writeU64(dv, 4 * ULONG_SIZE, dcBuf.length);
  writeU64(dv, 5 * ULONG_SIZE, rleBuf.length);
  writeU64(dv, 6 * ULONG_SIZE, rleUncompressed.length);
  writeU64(dv, 7 * ULONG_SIZE, rleRawSize);
  writeU64(dv, 8 * ULONG_SIZE, acRaw.length);
  writeU64(dv, 9 * ULONG_SIZE, totalDcCount);
  writeU64(dv, 10 * ULONG_SIZE, 0); // acCompression: 0 = static Huffman

  let pos = headerSize;
  dv.setUint16(pos, ruleSize, true);
  pos += ruleSize;
  result.set(unknownBuf, pos);
  pos += unknownBuf.length;
  result.set(acBuf, pos);
  pos += acBuf.length;
  result.set(dcBuf, pos);
  pos += dcBuf.length;
  result.set(rleBuf, pos);
  pos += rleBuf.length;

  return result;
}
