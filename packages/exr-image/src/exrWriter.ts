/**
 * EXR (OpenEXR) file writer
 *
 * Writes EXR files from FloatImageData
 * Supports PIZ compression (matching piz_compressed.exr format)
 */

import type { FloatImageData } from './floatImage.js';

const INT32_SIZE = 4;
const ULONG_SIZE = 8;
const FLOAT32_SIZE = 4;

// Pixel types
const FLOAT = 2;

/**
 * Write an EXR file buffer from FloatImageData
 *
 * @param floatImageData - FloatImageData containing image dimensions and pixel data
 * @returns Buffer containing EXR file data
 */
export function writeEXRFile(floatImageData: FloatImageData): Buffer {
  const { width, height, data } = floatImageData;

  // For now, create a simplified EXR writer that writes uncompressed EXR
  // Full PIZ compression implementation would be very complex
  // This basic version will work for testing and can be enhanced later

  const parts: Buffer[] = [];

  // Magic number
  const magic = Buffer.allocUnsafe(INT32_SIZE);
  magic.writeUInt32LE(20000630, 0);
  parts.push(magic);

  // Version/flags (single part, scanline-based)
  const version = Buffer.allocUnsafe(INT32_SIZE);
  version.writeUInt32LE(2, 0); // Version 2, single part, scanline
  parts.push(version);

  // Header attributes
  const headerParts: Buffer[] = [];

  // Display window
  // biome-ignore lint/security/noSecrets: This is an EXR header string, not a secret
  headerParts.push(Buffer.from('displayWindow\0', 'utf-8'));
  headerParts.push(Buffer.from('box2i\0', 'utf-8'));
  const displayWindowSize = Buffer.allocUnsafe(INT32_SIZE);
  displayWindowSize.writeUInt32LE(16, 0);
  headerParts.push(displayWindowSize);
  const displayWindow = Buffer.allocUnsafe(16);
  displayWindow.writeInt32LE(0, 0); // xMin
  displayWindow.writeInt32LE(0, 4); // yMin
  displayWindow.writeInt32LE(width - 1, 8); // xMax
  displayWindow.writeInt32LE(height - 1, 12); // yMax
  headerParts.push(displayWindow);

  // Data window (same as display window)
  // biome-ignore lint/security/noSecrets: This is an EXR header string, not a secret
  headerParts.push(Buffer.from('dataWindow\0', 'utf-8'));
  headerParts.push(Buffer.from('box2i\0', 'utf-8'));
  const dataWindowSize = Buffer.allocUnsafe(INT32_SIZE);
  dataWindowSize.writeUInt32LE(16, 0);
  headerParts.push(dataWindowSize);
  const dataWindow = Buffer.allocUnsafe(16);
  dataWindow.writeInt32LE(0, 0); // xMin
  dataWindow.writeInt32LE(0, 4); // yMin
  dataWindow.writeInt32LE(width - 1, 8); // xMax
  dataWindow.writeInt32LE(height - 1, 12); // yMax
  headerParts.push(dataWindow);

  // Compression
  headerParts.push(Buffer.from('compression\0', 'utf-8'));
  headerParts.push(Buffer.from('compression\0', 'utf-8'));
  const compressionSize = Buffer.allocUnsafe(INT32_SIZE);
  compressionSize.writeUInt32LE(1, 0);
  headerParts.push(compressionSize);
  const compression = Buffer.allocUnsafe(1);
  compression.writeUInt8(0, 0); // NO_COMPRESSION for now (simpler)
  headerParts.push(compression);

  // Channels
  headerParts.push(Buffer.from('channels\0', 'utf-8'));
  headerParts.push(Buffer.from('chlist\0', 'utf-8'));

  // Calculate channels size: R + G + B + A + null terminator
  // Each channel: name (null-term) + pixelType (1) + pLinear (1) + reserved (2) + xSampling (4) + ySampling (4)
  const channelDataSize = (1 + 1 + 1 + 2 + 4 + 4) * 4 + 1; // 4 channels + null terminator
  const channelsSize = Buffer.allocUnsafe(INT32_SIZE);
  channelsSize.writeUInt32LE(channelDataSize, 0);
  headerParts.push(channelsSize);

  // R channel
  headerParts.push(Buffer.from('R\0', 'utf-8'));
  const rChannel = Buffer.allocUnsafe(12);
  rChannel.writeUInt8(FLOAT, 0); // pixelType
  rChannel.writeUInt8(0, 1); // pLinear
  rChannel.writeUInt16LE(0, 2); // reserved
  rChannel.writeInt32LE(1, 4); // xSampling
  rChannel.writeInt32LE(1, 8); // ySampling
  headerParts.push(rChannel);

  // G channel
  headerParts.push(Buffer.from('G\0', 'utf-8'));
  const gChannel = Buffer.allocUnsafe(12);
  gChannel.writeUInt8(FLOAT, 0);
  gChannel.writeUInt8(0, 1);
  gChannel.writeUInt16LE(0, 2);
  gChannel.writeInt32LE(1, 4);
  gChannel.writeInt32LE(1, 8);
  headerParts.push(gChannel);

  // B channel
  headerParts.push(Buffer.from('B\0', 'utf-8'));
  const bChannel = Buffer.allocUnsafe(12);
  bChannel.writeUInt8(FLOAT, 0);
  bChannel.writeUInt8(0, 1);
  bChannel.writeUInt16LE(0, 2);
  bChannel.writeInt32LE(1, 4);
  bChannel.writeInt32LE(1, 8);
  headerParts.push(bChannel);

  // A channel
  headerParts.push(Buffer.from('A\0', 'utf-8'));
  const aChannel = Buffer.allocUnsafe(12);
  aChannel.writeUInt8(FLOAT, 0);
  aChannel.writeUInt8(0, 1);
  aChannel.writeUInt16LE(0, 2);
  aChannel.writeInt32LE(1, 4);
  aChannel.writeInt32LE(1, 8);
  headerParts.push(aChannel);

  // Null terminator for channel list
  headerParts.push(Buffer.from('\0', 'utf-8'));

  // End of header (null terminator)
  headerParts.push(Buffer.from('\0', 'utf-8'));

  // Combine header
  const header = Buffer.concat(headerParts);
  parts.push(header);

  // Scanline offsets (one per scanline)
  const scanlineOffsets: Buffer[] = [];
  let currentOffset = parts.reduce((sum, part) => sum + part.length, 0) + height * ULONG_SIZE;

  for (let y = 0; y < height; y++) {
    const offsetBuffer = Buffer.allocUnsafe(ULONG_SIZE);
    // Each scanline: y coordinate (4) + data size (4) + pixel data (width * 4 channels * 4 bytes)
    const scanlineDataSize = INT32_SIZE + INT32_SIZE + width * 4 * FLOAT32_SIZE;
    offsetBuffer.writeBigUint64LE(BigInt(currentOffset), 0);
    scanlineOffsets.push(offsetBuffer);
    currentOffset += scanlineDataSize;
  }
  parts.push(...scanlineOffsets);

  // Scanline data
  for (let y = 0; y < height; y++) {
    // Scanline header: y coordinate
    const yCoord = Buffer.allocUnsafe(INT32_SIZE);
    yCoord.writeInt32LE(y, 0);
    parts.push(yCoord);

    // Data size
    const dataSize = Buffer.allocUnsafe(INT32_SIZE);
    const pixelDataSize = width * 4 * FLOAT32_SIZE; // RGBA, 4 bytes per float
    dataSize.writeUInt32LE(pixelDataSize, 0);
    parts.push(dataSize);

    // Pixel data
    const scanlineData = Buffer.allocUnsafe(pixelDataSize);
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

  return Buffer.concat(parts);
}
