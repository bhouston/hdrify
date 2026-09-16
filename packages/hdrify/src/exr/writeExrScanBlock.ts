/**
 * EXR scan line block writer
 * Writes a single scan line block: y (4) + dataSize (4) + pixelData
 */

import type { HdrifyImage } from '../hdrifyImage.js';
import { compressB44Block } from './compressB44.js';
import { compressDwaBlock } from './compressDwa.js';
import { compressPizBlock } from './compressPiz.js';
import { compressPxr24Block } from './compressPxr24.js';
import { compressRleBlock } from './compressRle.js';
import { compressZipBlock } from './compressZip.js';
import {
  B44A_COMPRESSION,
  B44_COMPRESSION,
  DWAA_COMPRESSION,
  DWAB_COMPRESSION,
  FLOAT,
  FLOAT32_SIZE,
  HALF,
  INT16_SIZE,
  INT32_SIZE,
  NO_COMPRESSION,
  PIZ_COMPRESSION,
  PXR24_COMPRESSION,
  RLE_COMPRESSION,
  ZIP_COMPRESSION,
  ZIPS_COMPRESSION,
  UINT,
} from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';
import { encodeFloat16 } from './halfFloat.js';

function getPixelTypeSize(pixelType: number): number {
  switch (pixelType) {
    case UINT:
      return 4;
    case HALF:
      return INT16_SIZE;
    case FLOAT:
      return FLOAT32_SIZE;
    default:
      return FLOAT32_SIZE;
  }
}

export interface WriteExrScanBlockOptions {
  hdrifyImage: HdrifyImage;
  firstLineY: number;
  lineCount: number;
  compression: number;
  channels: ExrChannel[];
}

/** RGBA slot for a channel name, or -1 (written as 0). */
function getChannelSlot(channelName: string): number {
  const n = channelName.toLowerCase();
  if (n === 'r' || n === 'red') return 0;
  if (n === 'g' || n === 'green') return 1;
  if (n === 'b' || n === 'blue') return 2;
  if (n === 'a' || n === 'alpha') return 3;
  return -1;
}

/**
 * Write a single scan line block.
 * For NO_COMPRESSION: FLOAT, channel-planar per scanline (for each line: all R, all G, ...), like every codec.
 * For RLE/ZIP: half-float, reorder + predictor + compress.
 * Block layout: y coordinate (4) + pixel data size (4) + pixel data.
 */
export function writeExrScanBlock(options: WriteExrScanBlockOptions): Uint8Array {
  const { hdrifyImage, firstLineY, lineCount, compression, channels } = options;
  const { width, height, data } = hdrifyImage;

  const numChannels = channels.length;
  const useCompression = compression !== NO_COMPRESSION;
  const slots = channels.map((ch) => getChannelSlot(ch.name));
  const lastLine = Math.min(lineCount, height - firstLineY);

  if (useCompression) {
    const pixelsPerBlock = width * lineCount;
    const interleaved = new Uint8Array(pixelsPerBlock * numChannels * 2);
    const halves = new Uint16Array(interleaved.buffer);

    // Per scanline, channel-major: the raw layout every codec consumes.
    let o = 0;
    for (let ly = 0; ly < lastLine; ly++) {
      const lineStart = (firstLineY + ly) * width * 4;
      for (let c = 0; c < numChannels; c++) {
        const slot = slots[c]!;
        if (slot < 0) {
          o += width;
          continue;
        }
        for (let x = 0, p = lineStart + slot; x < width; x++, p += 4) {
          halves[o++] = encodeFloat16(data[p]!);
        }
      }
    }

    let pixelData: Uint8Array;
    switch (compression) {
      case PIZ_COMPRESSION:
        pixelData = compressPizBlock(interleaved, width, lineCount, channels);
        break;
      case PXR24_COMPRESSION:
        pixelData = compressPxr24Block(interleaved, width, lineCount, channels);
        break;
      case RLE_COMPRESSION:
        pixelData = compressRleBlock(interleaved);
        break;
      case DWAA_COMPRESSION:
      case DWAB_COMPRESSION:
        pixelData = compressDwaBlock(interleaved, width, lineCount, channels);
        break;
      case B44_COMPRESSION:
        pixelData = compressB44Block(interleaved, width, lineCount, channels, false);
        break;
      case B44A_COMPRESSION:
        pixelData = compressB44Block(interleaved, width, lineCount, channels, true);
        break;
      case ZIP_COMPRESSION:
      case ZIPS_COMPRESSION:
        pixelData = compressZipBlock(interleaved); // ZIP and ZIPS both use zlib
        break;
      default:
        throw new Error(
          `Compression ${compression} not implemented. Supported: none, RLE, ZIP, ZIPS, PIZ, PXR24, B44, B44A, DWAA, DWAB.`,
        );
    }

    // OpenEXR identifies raw chunks by their uncompressed size. Only store
    // encoded bytes when strictly smaller, including for lossy codecs.
    if (pixelData.length >= interleaved.length) pixelData = interleaved;

    const blockSize = INT32_SIZE + INT32_SIZE + pixelData.length;
    const result = new Uint8Array(blockSize);
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
    view.setInt32(0, firstLineY, true);
    view.setUint32(4, pixelData.length, true);
    result.set(pixelData, 8);
    return result;
  }

  const bytesPerChannel = getPixelTypeSize(channels[0]?.pixelType ?? FLOAT);
  const bytesPerPixel = numChannels * bytesPerChannel;
  const pixelDataSize = width * lineCount * bytesPerPixel;

  const blockSize = INT32_SIZE + INT32_SIZE + pixelDataSize;
  const result = new Uint8Array(blockSize);
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);

  view.setInt32(0, firstLineY, true);
  view.setUint32(4, pixelDataSize, true);

  if (bytesPerChannel !== FLOAT32_SIZE) {
    throw new Error(`Only FLOAT (32-bit) pixel type is supported for uncompressed. Got ${channels[0]?.pixelType}.`);
  }

  const out = new Float32Array(result.buffer, 8, width * lastLine * numChannels);
  let o = 0;
  for (let ly = 0; ly < lastLine; ly++) {
    const lineStart = (firstLineY + ly) * width * 4;
    for (let c = 0; c < numChannels; c++) {
      const slot = slots[c]!;
      if (slot < 0) {
        o += width;
        continue;
      }
      for (let x = 0, p = lineStart + slot; x < width; x++, p += 4) {
        out[o++] = data[p]!;
      }
    }
  }

  return result;
}
