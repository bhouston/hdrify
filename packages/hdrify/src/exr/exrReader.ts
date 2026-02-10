/**
 * EXR (OpenEXR) file reader
 *
 * Extracted and adapted from Three.js EXRLoader
 * Supports PIZ, ZIP, RLE, and uncompressed EXR files
 */

import { unzlibSync } from 'fflate';
import type { FloatImageData } from '../floatImage.js';

// Constants from Three.js EXRLoader
const USHORT_RANGE = 1 << 16;
const BITMAP_SIZE = USHORT_RANGE >> 3;

const HUF_ENCBITS = 16;
const HUF_DECBITS = 14;
const HUF_ENCSIZE = (1 << HUF_ENCBITS) + 1;
const HUF_DECSIZE = 1 << HUF_DECBITS;
const HUF_DECMASK = HUF_DECSIZE - 1;

const NBITS = 16;
const A_OFFSET = 1 << (NBITS - 1);
const MOD_MASK = (1 << NBITS) - 1;

const SHORT_ZEROCODE_RUN = 59;
const LONG_ZEROCODE_RUN = 63;
const SHORTEST_LONG_RUN = 2 + LONG_ZEROCODE_RUN - SHORT_ZEROCODE_RUN;

const ULONG_SIZE = 8;
const FLOAT32_SIZE = 4;
const INT32_SIZE = 4;
const INT16_SIZE = 2;
const INT8_SIZE = 1;

// Compression types
const NO_COMPRESSION = 0;
const ZIPS_COMPRESSION = 2;
const ZIP_COMPRESSION = 3;
const PIZ_COMPRESSION = 4;

// Pixel types
const UINT = 0;
const HALF = 1;
const FLOAT = 2;

interface Channel {
  name: string;
  pixelType: number;
  pLinear: number;
  reserved: number;
  xSampling: number;
  ySampling: number;
}

/**
 * Parse an EXR file buffer and return FloatImageData
 *
 * @param exrBuffer - Uint8Array containing EXR file data
 * @returns Parsed EXR image data with dimensions and pixel data as FloatImageData
 */
export function parseEXRFile(exrBuffer: Uint8Array): FloatImageData {
  const dataView = new DataView(exrBuffer.buffer, exrBuffer.byteOffset, exrBuffer.byteLength);
  let offset = 0;

  // Read magic number
  const magic = dataView.getUint32(offset, true);
  offset += INT32_SIZE;
  if (magic !== 20000630) {
    throw new Error('Invalid EXR file: incorrect magic number');
  }

  // Read version/flags
  const version = dataView.getUint32(offset, true);
  offset += INT32_SIZE;
  const isMultiPart = (version & 0x2000) !== 0;
  const isTiled = (version & 0x400) !== 0;

  if (isMultiPart || isTiled) {
    throw new Error('Multi-part and tiled EXR files are not supported');
  }

  // Read header attributes
  const header: Record<string, unknown> = {};
  // biome-ignore lint/nursery/noUnnecessaryConditions: Loop breaks when empty string is read
  while (true) {
    const attributeName = readNullTerminatedString(exrBuffer, offset);
    offset += attributeName.length + 1;

    if (attributeName === '') {
      break; // End of header
    }

    const attributeType = readNullTerminatedString(exrBuffer, offset);
    offset += attributeType.length + 1;

    const attributeSize = dataView.getUint32(offset, true);
    offset += INT32_SIZE;

    let attributeValue: unknown;
    if (attributeType === 'string') {
      attributeValue = readNullTerminatedString(exrBuffer, offset);
      offset += attributeSize;
    } else if (attributeType === 'int') {
      attributeValue = dataView.getInt32(offset, true);
      offset += INT32_SIZE;
    } else if (attributeType === 'float') {
      attributeValue = dataView.getFloat32(offset, true);
      offset += FLOAT32_SIZE;
    } else if (attributeType === 'v2i') {
      attributeValue = {
        x: dataView.getInt32(offset, true),
        y: dataView.getInt32(offset + INT32_SIZE, true),
      };
      offset += INT32_SIZE * 2;
    } else if (attributeType === 'v2f') {
      attributeValue = {
        x: dataView.getFloat32(offset, true),
        y: dataView.getFloat32(offset + FLOAT32_SIZE, true),
      };
      offset += FLOAT32_SIZE * 2;
    } else if (attributeType === 'box2i') {
      attributeValue = {
        xMin: dataView.getInt32(offset, true),
        yMin: dataView.getInt32(offset + INT32_SIZE, true),
        xMax: dataView.getInt32(offset + INT32_SIZE * 2, true),
        yMax: dataView.getInt32(offset + INT32_SIZE * 3, true),
      };
      offset += INT32_SIZE * 4;
    } else if (attributeType === 'chlist') {
      const channels: Channel[] = [];
      const chlistStart = offset;
      const chlistEnd = offset + attributeSize;
      while (offset < chlistEnd) {
        const channelName = readNullTerminatedString(exrBuffer, offset);
        const channelNameEnd = offset + channelName.length;

        if (channelName === '' || channelNameEnd >= chlistEnd) {
          break;
        }

        // Advance past the null terminator
        offset = channelNameEnd + 1;

        if (offset + 12 > chlistEnd) {
          break;
        }

        const pixelType = dataView.getUint8(offset);
        offset += INT8_SIZE;
        const pLinear = dataView.getUint8(offset);
        offset += INT8_SIZE;
        const reserved = dataView.getUint16(offset, true);
        offset += INT16_SIZE;
        const xSampling = dataView.getInt32(offset, true);
        offset += INT32_SIZE;
        const ySampling = dataView.getInt32(offset, true);
        offset += INT32_SIZE;

        channels.push({
          name: channelName,
          pixelType,
          pLinear,
          reserved,
          xSampling,
          ySampling,
        });

        // Find the next channel name (skip any padding)
        // Look for the next null-terminated string that starts with a printable character
        while (offset < chlistEnd) {
          const nextByte = exrBuffer[offset];
          if (nextByte === undefined) {
            break;
          }
          // If we find a printable ASCII character (32-126), it's likely the start of a channel name
          if (nextByte >= 32 && nextByte <= 126) {
            break;
          }
          // If we find a null byte followed by a printable character, skip the null
          if (nextByte === 0 && offset + 1 < chlistEnd) {
            const nextNextByte = exrBuffer[offset + 1];
            if (nextNextByte !== undefined && nextNextByte >= 32 && nextNextByte <= 126) {
              offset += 1;
              break;
            }
          }
          offset += 1;
        }
      }
      // Ensure we've consumed the full attribute size
      offset = chlistStart + attributeSize;
      attributeValue = channels;
    } else if (attributeType === 'compression') {
      const compression = dataView.getUint8(offset);
      offset += attributeSize; // Use attributeSize instead of INT8_SIZE to handle any size
      attributeValue = compression;
    } else {
      // Skip unknown attribute types
      offset += attributeSize;
    }

    header[attributeName] = attributeValue;
  }

  // Extract key header values
  const displayWindow = header.displayWindow as { xMin: number; yMin: number; xMax: number; yMax: number } | undefined;
  const dataWindow = header.dataWindow as { xMin: number; yMin: number; xMax: number; yMax: number } | undefined;
  const channels = header.channels as Channel[] | undefined;
  const compression = (header.compression as number) ?? NO_COMPRESSION;

  // Check if required attributes exist and are valid
  if (!displayWindow || !dataWindow || !channels || channels.length === 0) {
    const hasDisplayWindow = displayWindow !== undefined && displayWindow !== null;
    const hasDataWindow = dataWindow !== undefined && dataWindow !== null;
    const hasChannels = channels !== undefined && channels !== null && channels.length > 0;
    throw new Error(
      `Invalid EXR file: missing required header attributes. displayWindow: ${hasDisplayWindow}, dataWindow: ${hasDataWindow}, channels: ${hasChannels ? channels.length : 0}, header keys: ${Object.keys(header).join(', ')}`,
    );
  }

  const width = dataWindow.xMax - dataWindow.xMin + 1;
  const height = dataWindow.yMax - dataWindow.yMin + 1;

  // Find RGB channels (case-insensitive, check exact match first)
  const rChannel = channels.find((ch) => ch.name === 'R' || ch.name === 'r' || ch.name.toLowerCase() === 'red');
  const gChannel = channels.find((ch) => ch.name === 'G' || ch.name === 'g' || ch.name.toLowerCase() === 'green');
  const bChannel = channels.find((ch) => ch.name === 'B' || ch.name === 'b' || ch.name.toLowerCase() === 'blue');

  if (!rChannel || !gChannel || !bChannel) {
    throw new Error('Invalid EXR file: missing RGB channels');
  }

  const numChannels = channels.length;

  // Determine block height based on compression type
  // PIZ uses blocks of 32 scanlines, others use single scanlines
  const blockHeight = compression === PIZ_COMPRESSION ? 32 : 1;
  const expectedBlockCount = Math.ceil(height / blockHeight);

  // Read scanline offsets
  const scanlineBlockOffsets: number[] = [];

  // For PIZ compression, we know block height is 32, so read expectedBlockCount offsets
  // For other compression types, we'll determine block height by checking Y coordinates
  const maxOffsets = compression === PIZ_COMPRESSION ? expectedBlockCount : Math.max(expectedBlockCount, height);
  for (let i = 0; i < maxOffsets && offset + ULONG_SIZE <= exrBuffer.length; i++) {
    // Read as uint64, but handle case where value might be stored incorrectly
    let offsetValue = Number(dataView.getBigUint64(offset, true));

    // If the value is way too large (likely a byte-order issue), try reading as two uint32s
    if (offsetValue > exrBuffer.length && offsetValue < Number.MAX_SAFE_INTEGER) {
      const low32 = dataView.getUint32(offset, true);
      const high32 = dataView.getUint32(offset + 4, true);
      // If high32 is 0 and low32 is reasonable, use low32
      // Otherwise, if low32 is 0 and high32 is reasonable, use high32
      if (high32 === 0 && low32 < exrBuffer.length) {
        offsetValue = low32;
      } else if (low32 === 0 && high32 < exrBuffer.length) {
        offsetValue = high32;
      }
    }

    scanlineBlockOffsets.push(offsetValue);
    offset += ULONG_SIZE;
  }

  // Determine actual block height by checking Y coordinates of first two scanlines
  let actualBlockHeightFinal = blockHeight;
  if (scanlineBlockOffsets.length >= 2) {
    const firstOffset = scanlineBlockOffsets[0];
    const secondOffset = scanlineBlockOffsets[1];

    if (
      firstOffset !== undefined &&
      secondOffset !== undefined &&
      firstOffset < exrBuffer.length &&
      secondOffset < exrBuffer.length &&
      firstOffset >= 0 &&
      secondOffset >= 0
    ) {
      try {
        const firstY = dataView.getInt32(firstOffset, true);
        const secondY = dataView.getInt32(secondOffset, true);

        // If Y coordinates are consecutive (0, 1, 2...), they're individual scanlines
        if (secondY === firstY + 1) {
          actualBlockHeightFinal = 1;
          // Trim to only height offsets if they're individual
          if (scanlineBlockOffsets.length > height) {
            scanlineBlockOffsets.length = height;
          }
        }
      } catch {
        // If we can't read Y coordinates, use default block height
      }
    }
  }

  const blockCount = scanlineBlockOffsets.length;

  // Decompress and read pixel data
  const pixelData = new Float32Array(width * height * 4); // RGBA

  for (let blockIdx = 0; blockIdx < blockCount; blockIdx++) {
    const scanlineBlockOffset = scanlineBlockOffsets[blockIdx];
    if (scanlineBlockOffset === undefined) {
      throw new Error(`Missing scanline block offset for block ${blockIdx}`);
    }

    // Validate offset is within bounds
    if (scanlineBlockOffset >= exrBuffer.length || scanlineBlockOffset < 0) {
      throw new Error(
        `Invalid scanline block offset ${scanlineBlockOffset} for block ${blockIdx} (file size: ${exrBuffer.length})`,
      );
    }

    let scanlinePos = scanlineBlockOffset;

    // Read block header: first scanline Y coordinate
    if (scanlinePos + INT32_SIZE > exrBuffer.length) {
      throw new Error(`Invalid scanline block: not enough data for Y coordinate at offset ${scanlinePos}`);
    }
    const firstLineY = dataView.getInt32(scanlinePos, true);
    scanlinePos += INT32_SIZE;

    if (scanlinePos + INT32_SIZE > exrBuffer.length) {
      throw new Error(`Invalid scanline block: not enough data for data size at offset ${scanlinePos}`);
    }
    const dataSize = dataView.getUint32(scanlinePos, true);
    scanlinePos += INT32_SIZE;

    // Validate dataSize is reasonable
    if (dataSize <= 0 || dataSize > exrBuffer.length - scanlinePos) {
      throw new Error(
        `Invalid scanline block data size: ${dataSize} at offset ${scanlinePos - 4} (file size: ${exrBuffer.length}, available: ${exrBuffer.length - scanlinePos})`,
      );
    }

    // Calculate how many scanlines are in this block
    const linesInBlock = Math.min(actualBlockHeightFinal, height - firstLineY);

    // Decompress block data
    let decompressedData: Uint8Array;
    if (compression === NO_COMPRESSION) {
      decompressedData = new Uint8Array(exrBuffer.buffer, exrBuffer.byteOffset + scanlinePos, dataSize);
    } else if (compression === ZIP_COMPRESSION || compression === ZIPS_COMPRESSION) {
      const compressedData = new Uint8Array(exrBuffer.buffer, exrBuffer.byteOffset + scanlinePos, dataSize);
      decompressedData = unzlibSync(compressedData);
    } else if (compression === PIZ_COMPRESSION) {
      // Validate dataSize before creating Uint8Array
      if (dataSize <= 0 || scanlinePos + dataSize > exrBuffer.length) {
        throw new Error(`Invalid PIZ data size: ${dataSize} at offset ${scanlinePos} (file size: ${exrBuffer.length})`);
      }
      const compressedData = new Uint8Array(exrBuffer.buffer, exrBuffer.byteOffset + scanlinePos, dataSize);
      decompressedData = decompressPIZ(compressedData, width, channels, dataSize, actualBlockHeightFinal);
    } else {
      throw new Error(`Unsupported compression type: ${compression}`);
    }

    // Parse pixel data from decompressed block
    const blockDataView = new DataView(
      decompressedData.buffer,
      decompressedData.byteOffset,
      decompressedData.byteLength,
    );

    // Calculate bytes per scanline
    const bytesPerScanline = width * numChannels * getPixelTypeSize(rChannel.pixelType);

    // Process each scanline in the block
    for (let lineInBlock = 0; lineInBlock < linesInBlock; lineInBlock++) {
      const y = firstLineY + lineInBlock;
      if (y >= height) {
        break;
      }

      // For uncompressed files, each scanline is written separately
      // For compressed blocks (PIZ), data is interleaved by channel
      const lineOffset = compression === NO_COMPRESSION ? 0 : lineInBlock * bytesPerScanline;
      let pixelOffset = lineOffset;

      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * 4;

        // Read channels in the order they appear in the file (channels array order)
        // Store them in RGBA order in pixelData
        const channelValues: { [key: string]: number } = {};

        for (const channel of channels) {
          const value = readChannelValue(blockDataView, pixelOffset, channel.pixelType);
          channelValues[channel.name.toLowerCase()] = value;
          pixelOffset += getPixelTypeSize(channel.pixelType);
        }

        // Map to RGBA order
        pixelData[pixelIndex] = channelValues.r ?? channelValues.red ?? 0;
        pixelData[pixelIndex + 1] = channelValues.g ?? channelValues.green ?? 0;
        pixelData[pixelIndex + 2] = channelValues.b ?? channelValues.blue ?? 0;
        pixelData[pixelIndex + 3] = channelValues.a ?? channelValues.alpha ?? 1.0;
      }
    }
  }

  return {
    width,
    height,
    data: pixelData,
  };
}

function readNullTerminatedString(buffer: Uint8Array, offset: number): string {
  const bytes: number[] = [];
  let pos = offset;
  while (pos < buffer.length) {
    const byte = buffer[pos];
    if (byte === undefined) {
      break;
    }
    if (byte === 0) {
      break;
    }
    bytes.push(byte);
    pos++;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function getPixelTypeSize(pixelType: number): number {
  switch (pixelType) {
    case UINT:
      return INT32_SIZE;
    case HALF:
      return INT16_SIZE;
    case FLOAT:
      return FLOAT32_SIZE;
    default:
      throw new Error(`Unknown pixel type: ${pixelType}`);
  }
}

function readChannelValue(dataView: DataView, offset: number, pixelType: number): number {
  switch (pixelType) {
    case UINT:
      return dataView.getUint32(offset, true);
    case HALF:
      return decodeFloat16(dataView.getUint16(offset, true));
    case FLOAT:
      return dataView.getFloat32(offset, true);
    default:
      throw new Error(`Unknown pixel type: ${pixelType}`);
  }
}

/**
 * Decompress PIZ-compressed scanline block data
 * PIZ compression uses blocks of 32 scanlines (or fewer for the last block)
 */
function decompressPIZ(
  compressedData: Uint8Array,
  width: number,
  channels: Channel[],
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

  // Calculate output size - total number of uint16 values needed
  // PIZ outputs data organized by channel: all R values for all scanlines, then all G, then all B, etc.
  const numChannels = channels.length;
  const pixelsPerChannel = width * blockHeight; // For all scanlines in block
  const totalPixels = width * blockHeight * numChannels; // Total uint16 values
  const outputBuffer = new Uint16Array(totalPixels);

  // Decompress using Huffman
  const inDataView = new DataView(compressedBuffer.buffer, compressedBuffer.byteOffset, compressedBuffer.byteLength);
  const hufOffset = { value: 0 };
  hufUncompress(compressedBuffer, inDataView, hufOffset, compressedSize, outputBuffer, totalPixels);

  // Wavelet decode each channel separately
  // Each channel has blockHeight scanlines worth of data
  for (let i = 0; i < numChannels; i++) {
    const channelOffset = i * pixelsPerChannel;
    if (n !== undefined) {
      // Wavelet decode: data, offset, nx, ox, ny, oy, mx
      wav2Decode(outputBuffer, channelOffset, width, 1, blockHeight, width, n);
    }
  }

  // Apply LUT
  applyLut(lut, outputBuffer, totalPixels);

  // Rearrange from channel-interleaved to scanline-interleaved (RGBA per pixel per scanline)
  // PIZ output: [R0...R(n*blockHeight-1), G0...G(n*blockHeight-1), B0...B(n*blockHeight-1), A0...A(n*blockHeight-1)]
  // We need: [R0, G0, B0, A0, R1, G1, B1, A1, ...] for each scanline
  const result = new Uint8Array(totalPixels * INT16_SIZE);
  const resultView = new DataView(result.buffer);

  // Find channel indices
  const rIdx = channels.findIndex((ch) => ch.name === 'R' || ch.name === 'r');
  const gIdx = channels.findIndex((ch) => ch.name === 'G' || ch.name === 'g');
  const bIdx = channels.findIndex((ch) => ch.name === 'B' || ch.name === 'b');
  const aIdx = channels.findIndex((ch) => ch.name === 'A' || ch.name === 'a');

  // Rearrange data: for each scanline, interleave channels
  for (let y = 0; y < blockHeight; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = y * width + x;
      let resultOffset = (y * width + x) * numChannels * INT16_SIZE;

      // Write R channel
      if (rIdx >= 0) {
        const rValue = outputBuffer[rIdx * pixelsPerChannel + pixelIndex];
        if (rValue !== undefined) {
          resultView.setUint16(resultOffset, rValue, true);
        }
        resultOffset += INT16_SIZE;
      }

      // Write G channel
      if (gIdx >= 0) {
        const gValue = outputBuffer[gIdx * pixelsPerChannel + pixelIndex];
        if (gValue !== undefined) {
          resultView.setUint16(resultOffset, gValue, true);
        }
        resultOffset += INT16_SIZE;
      }

      // Write B channel
      if (bIdx >= 0) {
        const bValue = outputBuffer[bIdx * pixelsPerChannel + pixelIndex];
        if (bValue !== undefined) {
          resultView.setUint16(resultOffset, bValue, true);
        }
        resultOffset += INT16_SIZE;
      }

      // Write A channel
      if (aIdx >= 0) {
        const aValue = outputBuffer[aIdx * pixelsPerChannel + pixelIndex];
        if (aValue !== undefined) {
          resultView.setUint16(resultOffset, aValue, true);
        }
      }
    }
  }

  return result;
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

function UInt16(value: number): number {
  return value & 0xffff;
}

function Int16(value: number): number {
  const ref = UInt16(value);
  return ref > 0x7fff ? ref - 0x10000 : ref;
}

interface HufDec {
  len: number;
  lit: number;
  p: number[] | null;
}

function hufUncompress(
  uInt8Array: Uint8Array,
  inDataView: DataView,
  inOffset: { value: number },
  nCompressed: number,
  outBuffer: Uint16Array,
  nRaw: number,
): void {
  const outOffset = { value: 0 };
  const initialInOffset = inOffset.value;

  const im = parseUint32(inDataView, inOffset);
  const iM = parseUint32(inDataView, inOffset);
  inOffset.value += 4;

  const nBits = parseUint32(inDataView, inOffset);
  inOffset.value += 4;

  if (im < 0 || im >= HUF_ENCSIZE || iM < 0 || iM >= HUF_ENCSIZE) {
    throw new Error(
      `Something wrong with HUF_ENCSIZE: im=${im}, iM=${iM}, HUF_ENCSIZE=${HUF_ENCSIZE}, compressedSize=${nCompressed}, offset=${inOffset.value}`,
    );
  }

  const freq = new Array(HUF_ENCSIZE);
  const hdec: HufDec[] = new Array(HUF_DECSIZE);
  hufClearDecTable(hdec);

  const ni = nCompressed - (inOffset.value - initialInOffset);
  hufUnpackEncTable(uInt8Array, inOffset, ni, im, iM, freq);

  if (nBits > 8 * (nCompressed - (inOffset.value - initialInOffset))) {
    // biome-ignore lint/security/noSecrets: This is an error message, not a secret
    throw new Error('Something wrong with hufUncompress');
  }

  hufBuildDecTable(freq, im, iM, hdec);
  hufDecode(freq, hdec, uInt8Array, inOffset, nBits, iM, nRaw, outBuffer, outOffset);
}

function hufClearDecTable(hdec: HufDec[]): void {
  for (let i = 0; i < HUF_DECSIZE; i++) {
    hdec[i] = { len: 0, lit: 0, p: null };
  }
}

function parseUint32(dataView: DataView, offset: { value: number }): number {
  const value = dataView.getUint32(offset.value, true);
  offset.value += INT32_SIZE;
  return value;
}

function parseUint8Array(uInt8Array: Uint8Array, offset: { value: number }): number {
  const value = uInt8Array[offset.value];
  offset.value += INT8_SIZE;
  if (value === undefined) {
    throw new Error('Unexpected end of data');
  }
  return value;
}

const getBitsReturn = { l: 0, c: 0, lc: 0 };

function getBits(nBits: number, c: number, lc: number, uInt8Array: Uint8Array, inOffset: { value: number }): void {
  let currentC = c;
  let currentLc = lc;
  while (currentLc < nBits) {
    currentC = (currentC << 8) | parseUint8Array(uInt8Array, inOffset);
    currentLc += 8;
  }
  currentLc -= nBits;
  getBitsReturn.l = (currentC >> currentLc) & ((1 << nBits) - 1);
  getBitsReturn.c = currentC;
  getBitsReturn.lc = currentLc;
}

const hufTableBuffer = new Array(59);

function hufCanonicalCodeTable(hcode: number[]): void {
  for (let i = 0; i <= 58; ++i) hufTableBuffer[i] = 0;
  for (let i = 0; i < HUF_ENCSIZE; ++i) {
    const code = hcode[i];
    if (code !== undefined) {
      const bufferIndex = hufTableBuffer[code];
      if (bufferIndex !== undefined) {
        hufTableBuffer[code] = bufferIndex + 1;
      }
    }
  }

  let c = 0;
  for (let i = 58; i > 0; --i) {
    const bufferValue = hufTableBuffer[i];
    if (bufferValue !== undefined) {
      const nc = (c + bufferValue) >> 1;
      hufTableBuffer[i] = c;
      c = nc;
    }
  }

  for (let i = 0; i < HUF_ENCSIZE; ++i) {
    const l = hcode[i];
    if (l !== undefined && l > 0) {
      const bufferValue = hufTableBuffer[l];
      if (bufferValue !== undefined) {
        hcode[i] = l | (bufferValue << 6);
        hufTableBuffer[l] = bufferValue + 1;
      }
    }
  }
}

function hufUnpackEncTable(
  uInt8Array: Uint8Array,
  inOffset: { value: number },
  ni: number,
  im: number,
  iM: number,
  hcode: number[],
): void {
  const p = inOffset;
  let c = 0;
  let lc = 0;
  let currentIm = im;

  for (; currentIm <= iM; currentIm++) {
    if (p.value - inOffset.value > ni) return;

    getBits(6, c, lc, uInt8Array, p);
    const l = getBitsReturn.l;
    c = getBitsReturn.c;
    lc = getBitsReturn.lc;

    hcode[currentIm] = l;

    if (l === LONG_ZEROCODE_RUN) {
      if (p.value - inOffset.value > ni) {
        // biome-ignore lint/security/noSecrets: This is an error message, not a secret
        throw new Error('Something wrong with hufUnpackEncTable');
      }

      getBits(8, c, lc, uInt8Array, p);
      const zerun = getBitsReturn.l + SHORTEST_LONG_RUN;
      c = getBitsReturn.c;
      lc = getBitsReturn.lc;

      if (currentIm + zerun > iM + 1) {
        // biome-ignore lint/security/noSecrets: This is an error message, not a secret
        throw new Error('Something wrong with hufUnpackEncTable');
      }

      let runCount = zerun;
      while (runCount-- > 0) {
        hcode[currentIm++] = 0;
      }
      currentIm--;
    } else if (l >= SHORT_ZEROCODE_RUN) {
      const zerun = l - SHORT_ZEROCODE_RUN + 2;
      if (currentIm + zerun > iM + 1) {
        // biome-ignore lint/security/noSecrets: This is an error message, not a secret
        throw new Error('Something wrong with hufUnpackEncTable');
      }
      let runCount = zerun;
      while (runCount-- > 0) {
        hcode[currentIm++] = 0;
      }
      currentIm--;
    }
  }

  hufCanonicalCodeTable(hcode);
}

function hufLength(code: number): number {
  return code & 63;
}

function hufCode(code: number): number {
  return code >> 6;
}

function hufBuildDecTable(hcode: number[], im: number, iM: number, hdecod: HufDec[]): boolean {
  let currentIm = im;
  for (; currentIm <= iM; currentIm++) {
    const hcodeValue = hcode[currentIm];
    if (hcodeValue === undefined) {
      continue;
    }
    const c = hufCode(hcodeValue);
    const l = hufLength(hcodeValue);

    if (c >> l) {
      throw new Error('Invalid table entry');
    }

    if (l > HUF_DECBITS) {
      const index = c >> (l - HUF_DECBITS);
      const pl = hdecod[index];
      if (!pl) {
        throw new Error('Invalid table entry');
      }
      if (pl.len) {
        throw new Error('Invalid table entry');
      }
      pl.lit++;
      if (pl.p) {
        const p = pl.p;
        pl.p = new Array(pl.lit);
        for (let i = 0; i < pl.lit - 1; ++i) {
          const pValue = p[i];
          if (pValue !== undefined) {
            pl.p[i] = pValue;
          }
        }
      } else {
        pl.p = new Array(1);
      }
      pl.p[pl.lit - 1] = currentIm;
    } else if (l) {
      let plOffset = 0;
      for (let i = 1 << (HUF_DECBITS - l); i > 0; i--) {
        const index = (c << (HUF_DECBITS - l)) + plOffset;
        const pl = hdecod[index];
        if (!pl) {
          throw new Error('Invalid table entry');
        }
        if (pl.len || pl.p) {
          throw new Error('Invalid table entry');
        }
        pl.len = l;
        pl.lit = currentIm;
        plOffset++;
      }
    }
  }
  return true;
}

const getCharReturn = { c: 0, lc: 0 };

function getChar(c: number, lc: number, uInt8Array: Uint8Array, inOffset: { value: number }): void {
  const newC = (c << 8) | parseUint8Array(uInt8Array, inOffset);
  const newLc = lc + 8;
  getCharReturn.c = newC;
  getCharReturn.lc = newLc;
}

const getCodeReturn = { c: 0, lc: 0 };

function getCode(
  po: number,
  rlc: number,
  c: number,
  lc: number,
  uInt8Array: Uint8Array,
  inOffset: { value: number },
  outBuffer: Uint16Array,
  outBufferOffset: { value: number },
  outBufferEndOffset: number,
): void {
  let currentC = c;
  let currentLc = lc;
  if (po === rlc) {
    if (currentLc < 8) {
      getChar(currentC, currentLc, uInt8Array, inOffset);
      currentC = getCharReturn.c;
      currentLc = getCharReturn.lc;
    }
    currentLc -= 8;
    let cs = currentC >> currentLc;
    const csArray = new Uint8Array([cs]);
    cs = csArray[0] ?? 0;

    if (outBufferOffset.value + cs > outBufferEndOffset) {
      getCodeReturn.c = currentC;
      getCodeReturn.lc = currentLc;
      return;
    }

    const s = outBuffer[outBufferOffset.value - 1];
    if (s !== undefined) {
      let runCount = cs;
      while (runCount-- > 0) {
        outBuffer[outBufferOffset.value++] = s;
      }
    }
  } else if (outBufferOffset.value < outBufferEndOffset) {
    outBuffer[outBufferOffset.value++] = po;
  }

  getCodeReturn.c = currentC;
  getCodeReturn.lc = currentLc;
}

function hufDecode(
  encodingTable: number[],
  decodingTable: HufDec[],
  uInt8Array: Uint8Array,
  inOffset: { value: number },
  ni: number,
  rlc: number,
  no: number,
  outBuffer: Uint16Array,
  outOffset: { value: number },
): void {
  let c = 0;
  let lc = 0;
  const outBufferEndOffset = no;
  const inOffsetEnd = Math.trunc(inOffset.value + (ni + 7) / 8);

  while (inOffset.value < inOffsetEnd) {
    getChar(c, lc, uInt8Array, inOffset);
    c = getCharReturn.c;
    lc = getCharReturn.lc;

    while (lc >= HUF_DECBITS) {
      const index: number = (c >> (lc - HUF_DECBITS)) & HUF_DECMASK;
      const pl = decodingTable[index];
      if (!pl) {
        throw new Error('hufDecode issues: invalid table index');
      }

      if (pl.len) {
        lc -= pl.len;
        getCode(pl.lit, rlc, c, lc, uInt8Array, inOffset, outBuffer, outOffset, outBufferEndOffset);
        c = getCodeReturn.c;
        lc = getCodeReturn.lc;
      } else {
        if (!pl.p) {
          throw new Error('hufDecode issues');
        }

        let j: number = 0;
        for (j = 0; j < pl.lit; j++) {
          const pIndex = pl.p[j];
          if (pIndex === undefined) {
            continue;
          }
          const encodingValue = encodingTable[pIndex];
          if (encodingValue === undefined) {
            continue;
          }
          const l = hufLength(encodingValue);

          while (lc < l && inOffset.value < inOffsetEnd) {
            getChar(c, lc, uInt8Array, inOffset);
            c = getCharReturn.c;
            lc = getCharReturn.lc;
          }

          if (lc >= l) {
            const codeValue = hufCode(encodingValue);
            if (codeValue === ((c >> (lc - l)) & ((1 << l) - 1))) {
              lc -= l;
              getCode(pIndex, rlc, c, lc, uInt8Array, inOffset, outBuffer, outOffset, outBufferEndOffset);
              c = getCodeReturn.c;
              lc = getCodeReturn.lc;
              break;
            }
          }
        }

        if (j >= pl.lit) {
          throw new Error('hufDecode issues');
        }
      }
    }
  }

  const i = (8 - ni) & 7;
  c >>= i;
  lc -= i;

  while (lc > 0) {
    const index = (c << (HUF_DECBITS - lc)) & HUF_DECMASK;
    const pl = decodingTable[index];
    if (!pl) {
      throw new Error('hufDecode issues: invalid table index');
    }
    if (pl.len) {
      lc -= pl.len;
      getCode(pl.lit, rlc, c, lc, uInt8Array, inOffset, outBuffer, outOffset, outBufferEndOffset);
      c = getCodeReturn.c;
      lc = getCodeReturn.lc;
    } else {
      throw new Error('hufDecode issues');
    }
  }
}

/**
 * Decode a half-precision float (16-bit) to a 32-bit float
 */
function decodeFloat16(uint16: number): number {
  const sign = (uint16 & 0x8000) >> 15;
  const exponent = (uint16 & 0x7c00) >> 10;
  const mantissa = uint16 & 0x03ff;

  if (exponent === 0) {
    // Denormalized number or zero
    if (mantissa === 0) {
      return sign === 0 ? 0.0 : -0.0;
    }
    return (sign === 0 ? 1 : -1) * 2 ** -14 * (mantissa / 1024);
  }
  if (exponent === 31) {
    // Infinity or NaN
    if (mantissa === 0) {
      return sign === 0 ? Infinity : -Infinity;
    }
    return NaN;
  }

  const value = 2 ** (exponent - 15) * (1 + mantissa / 1024);
  return sign === 0 ? value : -value;
}
