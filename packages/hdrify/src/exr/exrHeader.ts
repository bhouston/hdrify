/**
 * EXR header parsing
 * Parses magic, version, and attributes including chlist, displayWindow, dataWindow, compression
 */

import type { ExrBox2i, ExrChannel, ParsedExrHeader } from './exrTypes.js';
import {
  COMPRESSION_NAMES,
  EXR_MAGIC,
  FLOAT32_SIZE,
  INT16_SIZE,
  INT32_SIZE,
  INT8_SIZE,
  NO_COMPRESSION,
  SUPPORTED_COMPRESSION,
} from './exrConstants.js';

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

/**
 * Parse EXR file header from buffer.
 * Returns parsed header and the byte offset immediately after the header.
 *
 * @param exrBuffer - Full EXR file buffer
 * @returns Parsed header and offset after header
 */
export function parseExrHeader(exrBuffer: Uint8Array): { header: ParsedExrHeader; offset: number } {
  const dataView = new DataView(exrBuffer.buffer, exrBuffer.byteOffset, exrBuffer.byteLength);
  let offset = 0;

  // Read magic number
  const magic = dataView.getUint32(offset, true);
  offset += INT32_SIZE;
  if (magic !== EXR_MAGIC) {
    throw new Error('Invalid EXR file: incorrect magic number');
  }

  // Read version/flags (OpenEXR ImfVersion.h: TILED=0x200, NON_IMAGE=0x800, MULTI_PART=0x1000)
  const version = dataView.getUint32(offset, true);
  offset += INT32_SIZE;
  const isMultiPart = (version & 0x1000) !== 0;
  const isTiled = (version & 0x200) !== 0;
  const isDeepData = (version & 0x800) !== 0;

  if (isMultiPart || isTiled || isDeepData) {
    throw new Error(
      'Multi-part, tiled, and deep data EXR files are not supported. This reader supports single-part scanline images only.',
    );
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
      const channels: ExrChannel[] = [];
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

        // OpenEXR chlist: pixelType is int (4 bytes), pLinear u8 (1), reserved (2 or 3 bytes)
        const pixelTypeRaw = dataView.getInt32(offset, true);
        const pixelType =
          pixelTypeRaw >= 0 && pixelTypeRaw <= 2 ? pixelTypeRaw : dataView.getUint8(offset);
        offset += INT32_SIZE; // pixelType as int
        const pLinear = dataView.getUint8(offset);
        offset += INT8_SIZE;
        const reserved = dataView.getUint16(offset, true);
        offset += INT16_SIZE;
        // Skip extra reserved byte if present (spec says 3 bytes reserved)
        if (offset < chlistEnd && exrBuffer[offset] === 0 && offset + 1 < chlistEnd) {
          offset += 1;
        }
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
  const displayWindow = header.displayWindow as ExrBox2i | undefined;
  const dataWindow = header.dataWindow as ExrBox2i | undefined;
  const channels = header.channels as ExrChannel[] | undefined;
  const compression = (header.compression as number) ?? NO_COMPRESSION;

  if (!SUPPORTED_COMPRESSION.includes(compression)) {
    const name = COMPRESSION_NAMES[compression] ?? `unknown (${compression})`;
    throw new Error(
      `Unsupported EXR compression: ${name}. This reader supports: none, RLE, ZIPS, ZIP, PIZ.`,
    );
  }

  // Check if required attributes exist and are valid
  if (!displayWindow || !dataWindow || !channels || channels.length === 0) {
    const hasDisplayWindow = displayWindow !== undefined && displayWindow !== null;
    const hasDataWindow = dataWindow !== undefined && dataWindow !== null;
    const hasChannels = channels !== undefined && channels !== null && channels.length > 0;
    throw new Error(
      `Invalid EXR file: missing required header attributes. displayWindow: ${hasDisplayWindow}, dataWindow: ${hasDataWindow}, channels: ${hasChannels ? channels.length : 0}, header keys: ${Object.keys(header).join(', ')}`,
    );
  }

  return {
    header: {
      header,
      displayWindow,
      dataWindow,
      channels,
      compression,
    },
    offset,
  };
}
