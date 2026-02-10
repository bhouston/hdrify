/**
 * JPEG assembler for creating JPEG-R (JPEG with gain map) files
 * Based on libultrahdr jpegr.cpp implementation
 */

import type { CompressedImage, GainMapMetadataExtended } from '../types.js';
import { MARKER_PREFIX, MARKERS, XMP_NAMESPACE } from './jpeg-markers.js';
import { calculateMpfSize, generateMpf } from './mpf-generator.js';
import { generateXmpForPrimaryImage, generateXmpForSecondaryImage } from './xmp-generator.js';

export interface AssembleJpegOptions {
  sdr: CompressedImage;
  gainMap: CompressedImage;
  metadata: GainMapMetadataExtended;
  exif?: Uint8Array;
  icc?: Uint8Array;
}

const EXIF_SIGNATURE = 'Exif\0\0';

function extractExif(jpegData: Uint8Array): { data: Uint8Array; pos: number; size: number } | null {
  const view = new DataView(jpegData.buffer, jpegData.byteOffset, jpegData.byteLength);

  if (view.getUint8(0) !== MARKER_PREFIX || view.getUint8(1) !== MARKERS.SOI) {
    return null;
  }

  let offset = 2;

  while (offset < jpegData.length - 1) {
    if (view.getUint8(offset) !== MARKER_PREFIX) {
      break;
    }

    const marker = view.getUint8(offset + 1);

    if (marker === MARKERS.SOS) {
      break;
    }

    if (marker === MARKERS.APP1) {
      const length = view.getUint16(offset + 2, false);
      const dataStart = offset + 4;

      let isExif = false;
      if (dataStart + EXIF_SIGNATURE.length <= jpegData.length) {
        isExif = true;
        for (let i = 0; i < EXIF_SIGNATURE.length; i++) {
          if (jpegData[dataStart + i] !== EXIF_SIGNATURE.charCodeAt(i)) {
            isExif = false;
            break;
          }
        }
      }

      if (isExif) {
        const exifSize = length - 2;
        const exifData = jpegData.slice(dataStart, dataStart + exifSize);
        return {
          data: exifData,
          pos: offset,
          size: length + 2,
        };
      }
    }

    const length = view.getUint16(offset + 2, false);
    offset += 2 + length;
  }

  return null;
}

function copyJpegWithoutExif(jpegData: Uint8Array, exifPos: number, exifSize: number): Uint8Array {
  const newSize = jpegData.length - exifSize;
  const result = new Uint8Array(newSize);
  result.set(jpegData.subarray(0, exifPos), 0);
  result.set(jpegData.subarray(exifPos + exifSize), exifPos);
  return result;
}

function writeMarker(buffer: Uint8Array, startPos: number, marker: number, data?: Uint8Array): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let pos = startPos;

  view.setUint8(pos++, MARKER_PREFIX);
  view.setUint8(pos++, marker);

  if (data && data.length > 0) {
    const length = data.length + 2;
    view.setUint16(pos, length, false);
    pos += 2;
    buffer.set(data, pos);
    pos += data.length;
  }

  return pos;
}

export function assembleJpegWithGainMap(options: AssembleJpegOptions): Uint8Array {
  const { sdr, gainMap, metadata, exif: externalExif, icc } = options;

  if (sdr.mimeType !== 'image/jpeg') {
    throw new Error('SDR image must be JPEG format');
  }
  if (gainMap.mimeType !== 'image/jpeg') {
    throw new Error('Gain map image must be JPEG format');
  }

  const exifFromJpeg = extractExif(sdr.data);

  if (exifFromJpeg && externalExif) {
    throw new Error('Primary image already contains EXIF data, cannot add external EXIF');
  }

  let primaryJpegData = sdr.data;
  let exifData = externalExif;

  if (exifFromJpeg) {
    primaryJpegData = copyJpegWithoutExif(sdr.data, exifFromJpeg.pos, exifFromJpeg.size);
    exifData = exifFromJpeg.data;
  }

  const xmpSecondary = generateXmpForSecondaryImage(metadata);
  const xmpSecondaryBytes = new TextEncoder().encode(xmpSecondary);

  const namespaceBytes = new TextEncoder().encode(XMP_NAMESPACE);
  const secondaryImageSize = 2 + 2 + 2 + namespaceBytes.length + xmpSecondaryBytes.length + (gainMap.data.length - 2);

  const xmpPrimary = generateXmpForPrimaryImage(secondaryImageSize, metadata);
  const xmpPrimaryBytes = new TextEncoder().encode(xmpPrimary);
  const xmpPrimaryData = new Uint8Array(namespaceBytes.length + xmpPrimaryBytes.length);
  xmpPrimaryData.set(namespaceBytes, 0);
  xmpPrimaryData.set(xmpPrimaryBytes, namespaceBytes.length);

  const mpfLength = calculateMpfSize();

  let totalSize = 2;
  if (exifData) totalSize += 2 + 2 + exifData.length;
  totalSize += 2 + 2 + xmpPrimaryData.length;
  if (icc) totalSize += 2 + 2 + icc.length;
  totalSize += 2 + 2 + mpfLength;
  totalSize += primaryJpegData.length - 2;
  totalSize += secondaryImageSize;

  const primaryImageSize = totalSize - secondaryImageSize;
  const secondaryImageOffset =
    primaryImageSize -
    (2 +
      (exifData ? 2 + 2 + exifData.length : 0) +
      2 +
      2 +
      xmpPrimaryData.length +
      (icc ? 2 + 2 + icc.length : 0) +
      2 +
      2 +
      4);

  const mpfDataActual = generateMpf(primaryImageSize, 0, secondaryImageSize, secondaryImageOffset);

  const output = new Uint8Array(totalSize);
  let pos = 0;

  pos = writeMarker(output, pos, MARKERS.SOI);

  if (exifData) {
    pos = writeMarker(output, pos, MARKERS.APP1, exifData);
  }

  pos = writeMarker(output, pos, MARKERS.APP1, xmpPrimaryData);

  if (icc) {
    pos = writeMarker(output, pos, MARKERS.APP2, icc);
  }

  pos = writeMarker(output, pos, MARKERS.APP2, mpfDataActual);

  output.set(primaryJpegData.subarray(2), pos);
  pos += primaryJpegData.length - 2;

  pos = writeMarker(output, pos, MARKERS.SOI);

  const xmpSecondaryData = new Uint8Array(namespaceBytes.length + xmpSecondaryBytes.length);
  xmpSecondaryData.set(namespaceBytes, 0);
  xmpSecondaryData.set(xmpSecondaryBytes, namespaceBytes.length);
  pos = writeMarker(output, pos, MARKERS.APP1, xmpSecondaryData);

  output.set(gainMap.data.subarray(2), pos);

  return output;
}
