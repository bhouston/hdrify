/**
 * DWAA/DWAB decompression for OpenEXR.
 * Ported from the OpenEXRCore reference decoder (internal_dwa*.{c,h}): per-channel
 * classification into lossy-DCT (CSC-grouped RGB or single channel), RLE (e.g. alpha),
 * or UNKNOWN (zlib) groups; static-Huffman or deflate AC stream; zip-predictor DC stream;
 * 8x8 IDCT with no dequantization step (DWA quantizes on encode by picking values with
 * few bits set, so decode just inverse-DCTs the values as stored); inverse 709 CSC.
 */

import { unzlibSync } from 'fflate';
import { computeDwaChannelGroups, LEGACY_RULES, parseDwaRules } from './dwaClassify.js';
import { decompressRLE } from './decompressRle.js';
import { getLinearLut } from './dwaLuts.js';
import { applyExrPredictor, reorderExrPixels } from './exrDsp.js';
import { FLOAT, HALF } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';
import { decodeFloat16, encodeFloat16 } from './halfFloat.js';
import { hufUncompress } from './pizHuffman.js';

export function channelByteSize(pixelType: number): number {
  return pixelType === HALF ? 2 : 4;
}

// Zig-zag scan order for an 8x8 DCT block (src index for each normal-order dst index).
export const ZIGZAG = [
  0, 1, 5, 6, 14, 15, 27, 28, 2, 4, 7, 13, 16, 26, 29, 42, 3, 8, 12, 17, 25, 30, 41, 43, 9, 11, 18, 24, 31, 40, 44, 53,
  10, 19, 23, 32, 39, 45, 52, 54, 20, 22, 33, 38, 46, 51, 55, 60, 21, 34, 37, 47, 50, 56, 59, 61, 35, 36, 48, 49, 57,
  58, 62, 63,
];

function fromHalfZigZag(src: Uint16Array, dst: Float64Array): void {
  for (let i = 0; i < 64; i++) {
    dst[i] = decodeFloat16(src[ZIGZAG[i]!]!);
  }
}

const IDCT_A = 0.5 * Math.cos(Math.PI / 4);
const IDCT_B = 0.5 * Math.cos(Math.PI / 16);
const IDCT_C = 0.5 * Math.cos(Math.PI / 8);
const IDCT_D = 0.5 * Math.cos((3 * Math.PI) / 16);
const IDCT_E = 0.5 * Math.cos((5 * Math.PI) / 16);
const IDCT_F = 0.5 * Math.cos((3 * Math.PI) / 8);
const IDCT_G = 0.5 * Math.cos((7 * Math.PI) / 16);

// Full 8x8 inverse DCT, in place. The zeroedRows fast-path from the reference
// implementation is a pure perf optimization (skips known-zero rows); we always
// run the full transform since the zeroed inputs give the same result.
function idct8x8(data: Float64Array): void {
  const alpha = new Float64Array(4);
  const beta = new Float64Array(4);
  const theta = new Float64Array(4);
  const gamma = new Float64Array(4);

  for (let row = 0; row < 8; row++) {
    const o = row * 8;
    alpha[0] = IDCT_C * data[o + 2]!;
    alpha[1] = IDCT_F * data[o + 2]!;
    alpha[2] = IDCT_C * data[o + 6]!;
    alpha[3] = IDCT_F * data[o + 6]!;

    beta[0] = IDCT_B * data[o + 1]! + IDCT_D * data[o + 3]! + IDCT_E * data[o + 5]! + IDCT_G * data[o + 7]!;
    beta[1] = IDCT_D * data[o + 1]! - IDCT_G * data[o + 3]! - IDCT_B * data[o + 5]! - IDCT_E * data[o + 7]!;
    beta[2] = IDCT_E * data[o + 1]! - IDCT_B * data[o + 3]! + IDCT_G * data[o + 5]! + IDCT_D * data[o + 7]!;
    beta[3] = IDCT_G * data[o + 1]! - IDCT_E * data[o + 3]! + IDCT_D * data[o + 5]! - IDCT_B * data[o + 7]!;

    theta[0] = IDCT_A * (data[o]! + data[o + 4]!);
    theta[3] = IDCT_A * (data[o]! - data[o + 4]!);
    theta[1] = alpha[0]! + alpha[3]!;
    theta[2] = alpha[1]! - alpha[2]!;

    gamma[0] = theta[0]! + theta[1]!;
    gamma[1] = theta[3]! + theta[2]!;
    gamma[2] = theta[3]! - theta[2]!;
    gamma[3] = theta[0]! - theta[1]!;

    data[o] = gamma[0]! + beta[0]!;
    data[o + 1] = gamma[1]! + beta[1]!;
    data[o + 2] = gamma[2]! + beta[2]!;
    data[o + 3] = gamma[3]! + beta[3]!;
    data[o + 4] = gamma[3]! - beta[3]!;
    data[o + 5] = gamma[2]! - beta[2]!;
    data[o + 6] = gamma[1]! - beta[1]!;
    data[o + 7] = gamma[0]! - beta[0]!;
  }

  for (let col = 0; col < 8; col++) {
    alpha[0] = IDCT_C * data[16 + col]!;
    alpha[1] = IDCT_F * data[16 + col]!;
    alpha[2] = IDCT_C * data[48 + col]!;
    alpha[3] = IDCT_F * data[48 + col]!;

    beta[0] = IDCT_B * data[8 + col]! + IDCT_D * data[24 + col]! + IDCT_E * data[40 + col]! + IDCT_G * data[56 + col]!;
    beta[1] = IDCT_D * data[8 + col]! - IDCT_G * data[24 + col]! - IDCT_B * data[40 + col]! - IDCT_E * data[56 + col]!;
    beta[2] = IDCT_E * data[8 + col]! - IDCT_B * data[24 + col]! + IDCT_G * data[40 + col]! + IDCT_D * data[56 + col]!;
    beta[3] = IDCT_G * data[8 + col]! - IDCT_E * data[24 + col]! + IDCT_D * data[40 + col]! - IDCT_B * data[56 + col]!;

    theta[0] = IDCT_A * (data[col]! + data[32 + col]!);
    theta[3] = IDCT_A * (data[col]! - data[32 + col]!);
    theta[1] = alpha[0]! + alpha[3]!;
    theta[2] = alpha[1]! - alpha[2]!;

    gamma[0] = theta[0]! + theta[1]!;
    gamma[1] = theta[3]! + theta[2]!;
    gamma[2] = theta[3]! - theta[2]!;
    gamma[3] = theta[0]! - theta[1]!;

    data[col] = gamma[0]! + beta[0]!;
    data[8 + col] = gamma[1]! + beta[1]!;
    data[16 + col] = gamma[2]! + beta[2]!;
    data[24 + col] = gamma[3]! + beta[3]!;
    data[32 + col] = gamma[3]! - beta[3]!;
    data[40 + col] = gamma[2]! - beta[2]!;
    data[48 + col] = gamma[1]! - beta[1]!;
    data[56 + col] = gamma[0]! - beta[0]!;
  }
}

// Inverse 709 CSC, Y'CbCr -> R'G'B', with Cb/Cr zero-shifted (no +0.5 offset) since DWA
// operates on scene-referred data where a traditional chroma midpoint makes no sense.
function csc709Inverse64(y: Float64Array, cb: Float64Array, cr: Float64Array): void {
  for (let i = 0; i < 64; i++) {
    const yy = y[i]!;
    const cbv = cb[i]!;
    const crv = cr[i]!;
    y[i] = yy + 1.5747 * crv;
    cb[i] = yy - 0.1873 * cbv - 0.4682 * crv;
    cr[i] = yy + 1.8556 * cbv;
  }
}

// DWA has no explicit dequantization step: on encode, the quantizer picks (from a
// precomputed candidate list) the representable value with fewest bits set that's still
// within the per-component error bound, so decode just inverse-DCTs the stored values as-is.

function unRleAc(acRaw: Uint16Array, cursor: { value: number }, halfZig: Uint16Array): void {
  let dctComp = 1;
  while (dctComp < 64) {
    if (cursor.value >= acRaw.length) throw new Error('DWA: AC stream truncated');
    const val = acRaw[cursor.value++]!;
    if ((val & 0xff00) === 0xff00) {
      const count = val & 0xff;
      dctComp += count === 0 ? 64 : count;
    } else {
      halfZig[dctComp] = val;
      dctComp++;
    }
  }
}

function decodeLossyDctGroup(
  compIdx: number[],
  width: number,
  height: number,
  acRaw: Uint16Array,
  acCursor: { value: number },
  dcRaw: Uint16Array,
  dcCursor: { value: number },
  channels: ExrChannel[],
  channelOut: Uint8Array[],
  forceLinear: boolean,
): void {
  const numComp = compIdx.length;
  const numBlocksX = Math.ceil(width / 8);
  const numBlocksY = Math.ceil(height / 8);
  const leftoverX = width - (numBlocksX - 1) * 8;
  const leftoverY = height - (numBlocksY - 1) * 8;

  const dcPtr: number[] = [];
  for (let c = 0; c < numComp; c++) dcPtr.push(dcCursor.value + c * numBlocksX * numBlocksY);
  dcCursor.value += numComp * numBlocksX * numBlocksY;

  const dctData: Float64Array[] = Array.from({ length: numComp }, () => new Float64Array(64));
  const halfZig: Uint16Array[] = Array.from({ length: numComp }, () => new Uint16Array(64));
  const rowsHalf: Uint16Array[] = Array.from({ length: numComp }, () => new Uint16Array(width * height));

  for (let blocky = 0; blocky < numBlocksY; blocky++) {
    const maxY = blocky === numBlocksY - 1 ? leftoverY : 8;
    for (let blockx = 0; blockx < numBlocksX; blockx++) {
      const maxX = blockx === numBlocksX - 1 ? leftoverX : 8;

      for (let c = 0; c < numComp; c++) {
        const hz = halfZig[c]!;
        hz.fill(0);
        hz[0] = dcRaw[dcPtr[c]!]!;
        dcPtr[c] = dcPtr[c]! + 1;
        unRleAc(acRaw, acCursor, hz);

        const dd = dctData[c]!;
        fromHalfZigZag(hz, dd);
        idct8x8(dd);
      }

      if (numComp === 3) {
        csc709Inverse64(dctData[0]!, dctData[1]!, dctData[2]!);
      }

      for (let c = 0; c < numComp; c++) {
        const dd = dctData[c]!;
        const rh = rowsHalf[c]!;
        for (let by = 0; by < maxY; by++) {
          const y = blocky * 8 + by;
          const rowOff = y * width + blockx * 8;
          for (let bx = 0; bx < maxX; bx++) {
            rh[rowOff + bx] = encodeFloat16(dd[by * 8 + bx]!);
          }
        }
      }
    }
  }

  const lut = forceLinear ? getLinearLut() : null;
  for (let c = 0; c < numComp; c++) {
    const channel = channels[compIdx[c]!]!;
    const rh = rowsHalf[c]!;
    const outArr = channelOut[compIdx[c]!]!;
    const outDv = new DataView(outArr.buffer, outArr.byteOffset, outArr.byteLength);
    const n = width * height;
    if (channel.pixelType === FLOAT) {
      for (let i = 0; i < n; i++) {
        const h = lut ? lut[rh[i]!]! : rh[i]!;
        outDv.setFloat32(i * 4, decodeFloat16(h), true);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const h = lut ? lut[rh[i]!]! : rh[i]!;
        outDv.setUint16(i * 2, h, true);
      }
    }
  }
}

/**
 * Decompress a DWAA/DWAB-compressed scanline block.
 * blockHeight is the actual number of scanlines in this chunk (32 for DWAA, 256 for
 * DWAB, possibly fewer for the final, partial chunk of the image) - same convention
 * as decompressPxr24/decompressPiz's blockHeight parameter.
 */
export function decompressDwa(
  compressedData: Uint8Array,
  width: number,
  channels: ExrChannel[],
  _dataSize: number,
  blockHeight: number,
): Uint8Array {
  const dv = new DataView(compressedData.buffer, compressedData.byteOffset, compressedData.byteLength);
  const HEADER_FIELDS = 11;
  const headerSize = HEADER_FIELDS * 8;
  if (compressedData.length < headerSize) throw new Error('DWA: chunk too small for header');

  const readU64 = (i: number) => Number(dv.getBigUint64(i * 8, true));
  const version = readU64(0);
  const unknownUncompressedSize = readU64(1);
  const unknownCompressedSize = readU64(2);
  const acCompressedSize = readU64(3);
  const dcCompressedSize = readU64(4);
  const rleCompressedSize = readU64(5);
  const rleUncompressedSize = readU64(6);
  const rleRawSize = readU64(7);
  const totalAcUncompressedCount = readU64(8);
  const totalDcUncompressedCount = readU64(9);
  const acCompression = readU64(10);

  if (version > 2) throw new Error(`DWA: unsupported version ${version}`);
  const legacy = version < 2;

  let pos = headerSize;
  let rules = LEGACY_RULES;
  if (!legacy) {
    const parsed = parseDwaRules(compressedData.subarray(pos));
    rules = parsed.rules;
    pos += parsed.size;
  }

  if (pos + unknownCompressedSize + acCompressedSize + dcCompressedSize + rleCompressedSize > compressedData.length) {
    throw new Error('DWA: chunk data shorter than declared sizes');
  }

  const unknownBuf = compressedData.subarray(pos, pos + unknownCompressedSize);
  pos += unknownCompressedSize;
  const acBuf = compressedData.subarray(pos, pos + acCompressedSize);
  pos += acCompressedSize;
  const dcBuf = compressedData.subarray(pos, pos + dcCompressedSize);
  pos += dcCompressedSize;
  const rleBuf = compressedData.subarray(pos, pos + rleCompressedSize);
  pos += rleCompressedSize;

  const unknownRaw = unknownCompressedSize > 0 ? unzlibSync(unknownBuf) : new Uint8Array(0);
  if (unknownRaw.length < unknownUncompressedSize) {
    throw new Error('DWA: unknown-data stream shorter than declared');
  }

  let acRaw: Uint16Array;
  if (acCompressedSize > 0) {
    if (acCompression === 0) {
      acRaw = new Uint16Array(totalAcUncompressedCount);
      hufUncompress(
        acBuf,
        new DataView(acBuf.buffer, acBuf.byteOffset, acBuf.byteLength),
        { value: 0 },
        acCompressedSize,
        acRaw,
        totalAcUncompressedCount,
      );
    } else {
      const raw = unzlibSync(acBuf);
      acRaw = new Uint16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
    }
  } else {
    acRaw = new Uint16Array(0);
  }

  let dcRaw: Uint16Array;
  if (dcCompressedSize > 0) {
    const uncompBytes = totalDcUncompressedCount * 2;
    const dcZip = unzlibSync(dcBuf);
    if (dcZip.length < uncompBytes) throw new Error('DWA: DC stream shorter than declared');
    applyExrPredictor(dcZip);
    const reordered = new Uint8Array(uncompBytes);
    reorderExrPixels(reordered, dcZip.subarray(0, uncompBytes));
    dcRaw = new Uint16Array(reordered.buffer, reordered.byteOffset, totalDcUncompressedCount);
  } else {
    dcRaw = new Uint16Array(0);
  }

  let rleRaw: Uint8Array;
  if (rleRawSize > 0) {
    const rleZip = unzlibSync(rleBuf);
    if (rleZip.length < rleUncompressedSize) throw new Error('DWA: RLE stream shorter than declared');
    rleRaw = decompressRLE(rleZip.subarray(0, rleUncompressedSize), rleRawSize);
  } else {
    rleRaw = new Uint8Array(0);
  }

  // Classify channels and find CSC-groupable RGB triplets (matches
  // DwaCompressor_classifyChannels: same suffix/type rules, grouped by name prefix).
  const { classes, cscGroups, grouped } = computeDwaChannelGroups(channels, rules);

  const bpeArr = channels.map((ch) => channelByteSize(ch.pixelType));
  const channelOut: Uint8Array[] = channels.map((_, i) => new Uint8Array(width * blockHeight * bpeArr[i]!));

  const acCursor = { value: 0 };
  const dcCursor = { value: 0 };

  for (const group of cscGroups) {
    decodeLossyDctGroup(group, width, blockHeight, acRaw, acCursor, dcRaw, dcCursor, channels, channelOut, true);
  }

  let rleCursor = 0;
  let unknownCursor = 0;
  for (let i = 0; i < channels.length; i++) {
    if (grouped.has(i)) continue;
    const cls = classes[i]!;
    const channel = channels[i]!;

    if (cls.scheme === 'DCT') {
      decodeLossyDctGroup(
        [i],
        width,
        blockHeight,
        acRaw,
        acCursor,
        dcRaw,
        dcCursor,
        channels,
        channelOut,
        !channel.pLinear,
      );
    } else if (cls.scheme === 'RLE') {
      const bpe = bpeArr[i]!;
      const planeSize = width * blockHeight;
      const chanSlice = rleRaw.subarray(rleCursor, rleCursor + bpe * planeSize);
      rleCursor += bpe * planeSize;
      const outArr = channelOut[i]!;
      for (let p = 0; p < planeSize; p++) {
        for (let b = 0; b < bpe; b++) {
          outArr[p * bpe + b] = chanSlice[b * planeSize + p]!;
        }
      }
    } else {
      const bpe = bpeArr[i]!;
      const size = width * blockHeight * bpe;
      channelOut[i]!.set(unknownRaw.subarray(unknownCursor, unknownCursor + size));
      unknownCursor += size;
    }
  }

  // Assemble channel-planar, line-major output (same convention as decompressPxr24).
  let totalOutputSize = 0;
  for (let i = 0; i < channels.length; i++) totalOutputSize += width * blockHeight * bpeArr[i]!;
  const output = new Uint8Array(totalOutputSize);
  let writeOffset = 0;
  for (let y = 0; y < blockHeight; y++) {
    for (let c = 0; c < channels.length; c++) {
      const bpe = bpeArr[c]!;
      const src = channelOut[c]!;
      const rowStart = y * width * bpe;
      output.set(src.subarray(rowStart, rowStart + width * bpe), writeOffset);
      writeOffset += width * bpe;
    }
  }

  return output;
}
