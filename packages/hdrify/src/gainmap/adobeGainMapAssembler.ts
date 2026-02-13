/**
 * Adobe-style gain map assembler.
 * Produces a simpler layout: primary SDR JPEG + second SOI + gain map JPEG with hdrgm XMP.
 * No MPF, no Container:Directory. Matches the second-SOI structure that readJpegGainMap expects.
 */

import type { CompressedImage, GainMapMetadataExtended } from './types.js';
import { MARKER_PREFIX, MARKERS, XMP_NAMESPACE } from './libultrahdr/jpeg-markers.js';
import { generateXmpForSecondaryImage } from './libultrahdr/xmp-generator.js';

export interface AdobeGainMapAssembleOptions {
  sdr: CompressedImage;
  gainMap: CompressedImage;
  metadata: GainMapMetadataExtended;
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

/**
 * Assemble Adobe gain map format: primary JPEG (unchanged) + second SOI + gain map with hdrgm XMP.
 */
export function assembleJpegAdobeGainMap(options: AdobeGainMapAssembleOptions): Uint8Array {
  const { sdr, gainMap, metadata } = options;

  if (sdr.mimeType !== 'image/jpeg') {
    throw new Error('SDR image must be JPEG format');
  }
  if (gainMap.mimeType !== 'image/jpeg') {
    throw new Error('Gain map image must be JPEG format');
  }

  const xmpSecondary = generateXmpForSecondaryImage(metadata);
  const xmpSecondaryBytes = new TextEncoder().encode(xmpSecondary);
  const namespaceBytes = new TextEncoder().encode(XMP_NAMESPACE);
  const xmpSecondaryData = new Uint8Array(namespaceBytes.length + xmpSecondaryBytes.length);
  xmpSecondaryData.set(namespaceBytes, 0);
  xmpSecondaryData.set(xmpSecondaryBytes, namespaceBytes.length);

  const totalSize =
    sdr.data.length + 2 + 2 + 2 + xmpSecondaryData.length + (gainMap.data.length - 2);

  const output = new Uint8Array(totalSize);
  let pos = 0;

  output.set(sdr.data, pos);
  pos += sdr.data.length;

  pos = writeMarker(output, pos, MARKERS.SOI);
  pos = writeMarker(output, pos, MARKERS.APP1, xmpSecondaryData);
  output.set(gainMap.data.subarray(2), pos);

  return output;
}
