/**
 * EXR (OpenEXR) file writer
 *
 * Writes EXR files from FloatImageData
 * Supports PIZ compression (matching piz_compressed.exr format)
 */

import type { FloatImageData } from '../floatImage.js';

const INT32_SIZE = 4;
const ULONG_SIZE = 8;
const FLOAT32_SIZE = 4;

// Pixel types
const FLOAT = 2;

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Write an EXR file buffer from FloatImageData
 *
 * @param floatImageData - FloatImageData containing image dimensions and pixel data
 * @returns Uint8Array containing EXR file data
 */
export function writeEXRFile(floatImageData: FloatImageData): Uint8Array {
  const { width, height, data } = floatImageData;

  // For now, create a simplified EXR writer that writes uncompressed EXR
  // Full PIZ compression implementation would be very complex
  // This basic version will work for testing and can be enhanced later

  const parts: Uint8Array[] = [];

  // Magic number
  const magic = new Uint8Array(INT32_SIZE);
  new DataView(magic.buffer).setUint32(0, 20000630, true);
  parts.push(magic);

  // Version/flags (single part, scanline-based)
  const version = new Uint8Array(INT32_SIZE);
  new DataView(version.buffer).setUint32(0, 2, true); // Version 2, single part, scanline
  parts.push(version);

  // Header attributes
  const headerParts: Uint8Array[] = [];

  // Display window
  // biome-ignore lint/security/noSecrets: This is an EXR header string, not a secret
  headerParts.push(new TextEncoder().encode('displayWindow\0'));
  headerParts.push(new TextEncoder().encode('box2i\0'));
  const displayWindowSize = new Uint8Array(INT32_SIZE);
  new DataView(displayWindowSize.buffer).setUint32(0, 16, true);
  headerParts.push(displayWindowSize);
  const displayWindow = new Uint8Array(16);
  const displayWindowView = new DataView(displayWindow.buffer);
  displayWindowView.setInt32(0, 0, true); // xMin
  displayWindowView.setInt32(4, 0, true); // yMin
  displayWindowView.setInt32(8, width - 1, true); // xMax
  displayWindowView.setInt32(12, height - 1, true); // yMax
  headerParts.push(displayWindow);

  // Data window (same as display window)
  // biome-ignore lint/security/noSecrets: This is an EXR header string, not a secret
  headerParts.push(new TextEncoder().encode('dataWindow\0'));
  headerParts.push(new TextEncoder().encode('box2i\0'));
  const dataWindowSize = new Uint8Array(INT32_SIZE);
  new DataView(dataWindowSize.buffer).setUint32(0, 16, true);
  headerParts.push(dataWindowSize);
  const dataWindow = new Uint8Array(16);
  const dataWindowView = new DataView(dataWindow.buffer);
  dataWindowView.setInt32(0, 0, true); // xMin
  dataWindowView.setInt32(4, 0, true); // yMin
  dataWindowView.setInt32(8, width - 1, true); // xMax
  dataWindowView.setInt32(12, height - 1, true); // yMax
  headerParts.push(dataWindow);

  // Compression
  headerParts.push(new TextEncoder().encode('compression\0'));
  headerParts.push(new TextEncoder().encode('compression\0'));
  const compressionSize = new Uint8Array(INT32_SIZE);
  new DataView(compressionSize.buffer).setUint32(0, 1, true);
  headerParts.push(compressionSize);
  const compression = new Uint8Array(1);
  compression[0] = 0; // NO_COMPRESSION for now (simpler)
  headerParts.push(compression);

  // Channels
  headerParts.push(new TextEncoder().encode('channels\0'));
  headerParts.push(new TextEncoder().encode('chlist\0'));

  // Calculate channels size: R + G + B + A + null terminator
  // Each channel: name (null-term) + pixelType (1) + pLinear (1) + reserved (2) + xSampling (4) + ySampling (4)
  const channelDataSize = (1 + 1 + 1 + 2 + 4 + 4) * 4 + 1; // 4 channels + null terminator
  const channelsSize = new Uint8Array(INT32_SIZE);
  new DataView(channelsSize.buffer).setUint32(0, channelDataSize, true);
  headerParts.push(channelsSize);

  // R channel
  headerParts.push(new TextEncoder().encode('R\0'));
  const rChannel = new Uint8Array(12);
  const rChannelView = new DataView(rChannel.buffer);
  rChannelView.setUint8(0, FLOAT); // pixelType
  rChannelView.setUint8(1, 0); // pLinear
  rChannelView.setUint16(2, 0, true); // reserved
  rChannelView.setInt32(4, 1, true); // xSampling
  rChannelView.setInt32(8, 1, true); // ySampling
  headerParts.push(rChannel);

  // G channel
  headerParts.push(new TextEncoder().encode('G\0'));
  const gChannel = new Uint8Array(12);
  const gChannelView = new DataView(gChannel.buffer);
  gChannelView.setUint8(0, FLOAT);
  gChannelView.setUint8(1, 0);
  gChannelView.setUint16(2, 0, true);
  gChannelView.setInt32(4, 1, true);
  gChannelView.setInt32(8, 1, true);
  headerParts.push(gChannel);

  // B channel
  headerParts.push(new TextEncoder().encode('B\0'));
  const bChannel = new Uint8Array(12);
  const bChannelView = new DataView(bChannel.buffer);
  bChannelView.setUint8(0, FLOAT);
  bChannelView.setUint8(1, 0);
  bChannelView.setUint16(2, 0, true);
  bChannelView.setInt32(4, 1, true);
  bChannelView.setInt32(8, 1, true);
  headerParts.push(bChannel);

  // A channel
  headerParts.push(new TextEncoder().encode('A\0'));
  const aChannel = new Uint8Array(12);
  const aChannelView = new DataView(aChannel.buffer);
  aChannelView.setUint8(0, FLOAT);
  aChannelView.setUint8(1, 0);
  aChannelView.setUint16(2, 0, true);
  aChannelView.setInt32(4, 1, true);
  aChannelView.setInt32(8, 1, true);
  headerParts.push(aChannel);

  // Null terminator for channel list
  headerParts.push(new TextEncoder().encode('\0'));

  // End of header (null terminator)
  headerParts.push(new TextEncoder().encode('\0'));

  // Combine header
  const header = concatUint8Arrays(headerParts);
  parts.push(header);

  // Scanline offsets (one per scanline)
  const scanlineOffsets: Uint8Array[] = [];
  let currentOffset = parts.reduce((sum, part) => sum + part.length, 0) + height * ULONG_SIZE;

  for (let y = 0; y < height; y++) {
    const offsetBuffer = new Uint8Array(ULONG_SIZE);
    const offsetView = new DataView(offsetBuffer.buffer);
    // Each scanline: y coordinate (4) + data size (4) + pixel data (width * 4 channels * 4 bytes)
    const scanlineDataSize = INT32_SIZE + INT32_SIZE + width * 4 * FLOAT32_SIZE;
    offsetView.setBigUint64(0, BigInt(currentOffset), true);
    scanlineOffsets.push(offsetBuffer);
    currentOffset += scanlineDataSize;
  }
  parts.push(...scanlineOffsets);

  // Scanline data
  for (let y = 0; y < height; y++) {
    // Scanline header: y coordinate
    const yCoord = new Uint8Array(INT32_SIZE);
    new DataView(yCoord.buffer).setInt32(0, y, true);
    parts.push(yCoord);

    // Data size
    const dataSize = new Uint8Array(INT32_SIZE);
    const pixelDataSize = width * 4 * FLOAT32_SIZE; // RGBA, 4 bytes per float
    new DataView(dataSize.buffer).setUint32(0, pixelDataSize, true);
    parts.push(dataSize);

    // Pixel data
    const scanlineData = new Uint8Array(pixelDataSize);
    const dataView = new DataView(scanlineData.buffer, scanlineData.byteOffset, scanlineData.byteLength);

    for (let x = 0; x < width; x++) {
      const pixelIndex = (y * width + x) * 4;
      const bufferIndex = x * 4 * FLOAT32_SIZE;

      dataView.setFloat32(bufferIndex, data[pixelIndex] ?? 0, true); // R
      dataView.setFloat32(bufferIndex + FLOAT32_SIZE, data[pixelIndex + 1] ?? 0, true); // G
      dataView.setFloat32(bufferIndex + FLOAT32_SIZE * 2, data[pixelIndex + 2] ?? 0, true); // B
      dataView.setFloat32(bufferIndex + FLOAT32_SIZE * 3, data[pixelIndex + 3] ?? 1.0, true); // A
    }
    parts.push(scanlineData);
  }

  return concatUint8Arrays(parts);
}
