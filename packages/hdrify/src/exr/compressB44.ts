/**
 * B44/B44A compression for OpenEXR.
 * Lossy 4x4-block compression for HALF channels. See b44Codec.ts for the
 * core block codec. Input is line-major (line, channel, x), matching
 * writeExrScanBlock's/compressPxr24Block's layout for RLE/ZIP/PXR24/DWA.
 */

import { convertBlockFromLinear, packB44Block } from './b44Codec.js';
import { INT16_SIZE } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';

/**
 * Compress a scanline block using B44 (flatFields=false) or B44A (flatFields=true).
 */
export function compressB44Block(
  rawHalfFloatPlanar: Uint8Array,
  width: number,
  lineCount: number,
  channels: ExrChannel[],
  flatFields: boolean,
): Uint8Array {
  const numChannels = channels.length;
  const rawSize = width * lineCount * numChannels * INT16_SIZE;
  if (rawHalfFloatPlanar.length < rawSize) {
    throw new Error(`B44: input too small (${rawHalfFloatPlanar.length} < ${rawSize})`);
  }

  const view = new DataView(rawHalfFloatPlanar.buffer, rawHalfFloatPlanar.byteOffset, rawHalfFloatPlanar.byteLength);
  const s = new Uint16Array(16);

  const blocksPerChannel = Math.ceil(width / 4) * Math.ceil(lineCount / 4);
  const out = new Uint8Array(numChannels * blocksPerChannel * 14);
  let outOffset = 0;

  for (let c = 0; c < numChannels; c++) {
    const channel = channels[c]!;

    for (let y = 0; y < lineCount; y += 4) {
      const rowsAvailable = Math.min(4, lineCount - y);
      for (let x = 0; x < width; x += 4) {
        const colsAvailable = Math.min(4, width - x);
        for (let ry = 0; ry < 4; ry++) {
          const srcRow = Math.min(ry, rowsAvailable - 1);
          for (let rx = 0; rx < 4; rx++) {
            const srcCol = Math.min(rx, colsAvailable - 1);
            const offset = ((y + srcRow) * numChannels * width + c * width + (x + srcCol)) * INT16_SIZE;
            s[ry * 4 + rx] = view.getUint16(offset, true);
          }
        }

        if (channel.pLinear) convertBlockFromLinear(s);

        const wcount = packB44Block(s, out.subarray(outOffset, outOffset + 14), flatFields, !channel.pLinear);
        outOffset += wcount;
      }
    }
  }

  return out.subarray(0, outOffset);
}
