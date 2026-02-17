/**
 * Read JPEG with embedded gain map (JPEG-R / Ultra HDR) into FloatImageData.
 * Throws if the buffer does not contain valid gain map metadata or both SDR and gain map images.
 */

import './ensureBuffer.js';
import { decode as jpegDecode } from 'jpeg-js';
import { ensureNonNegativeFinite, type FloatImageData } from '../floatImage.js';
import { decodeGainMapCpu } from './readJpegGainMap/decodeGainMapCpu.js';
import { extractGainMapXmp } from './readJpegGainMap/extractXmp.js';
import { extractImagesBySecondSoi, extractImagesFromMpf } from './readJpegGainMap/mpfExtractor.js';

export type GainMapFormat = 'ultrahdr' | 'adobe-gainmap';

/**
 * Read a JPEG buffer that contains embedded gain map (XMP + MPF) and return
 * decoded HDR as FloatImageData. Supports UltraHDR/JPEG-R layout.
 *
 * @param buffer - Full JPEG-R file bytes
 * @returns FloatImageData with linear HDR RGBA; metadata.format is 'ultrahdr' or 'adobe-gainmap'
 * @throws If no gain map XMP is found, or if primary/gain map images cannot be extracted
 */
export function readJpegGainMap(buffer: Uint8Array): FloatImageData {
  const metadata = extractGainMapXmp(buffer);
  let primaryImage: Uint8Array;
  let gainmapImage: Uint8Array;
  let format: 'ultrahdr' | 'adobe-gainmap';
  try {
    const extracted = extractImagesFromMpf(buffer);
    primaryImage = extracted.primaryImage;
    gainmapImage = extracted.gainmapImage;
    format = extracted.format;
  } catch {
    const fallback = extractImagesBySecondSoi(buffer);
    primaryImage = fallback.primaryImage;
    gainmapImage = fallback.gainmapImage;
    format = fallback.format;
  }

  const sdrDecoded = jpegDecode(primaryImage, { useTArray: true, formatAsRGBA: true });
  const gainDecoded = jpegDecode(gainmapImage, { useTArray: true, formatAsRGBA: true });

  const width = sdrDecoded.width;
  const height = sdrDecoded.height;
  const sdrData = new Uint8ClampedArray(sdrDecoded.data);
  let gainData = new Uint8ClampedArray(gainDecoded.data);

  if (sdrDecoded.width !== gainDecoded.width || sdrDecoded.height !== gainDecoded.height) {
    gainData = new Uint8ClampedArray(
      scaleToSize(gainDecoded.data as Uint8Array, gainDecoded.width, gainDecoded.height, width, height),
    );
  }

  const result = decodeGainMapCpu(sdrData, gainData, width, height, metadata);

  result.metadata = {
    ...metadata,
    format,
  };

  ensureNonNegativeFinite(result.data);
  return result;
}

function scaleToSize(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by loop and sw/sh
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(Math.floor((y * sh) / dh), sh - 1);
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(Math.floor((x * sw) / dw), sw - 1);
      const srcIdx = (sy * sw + sx) * 4;
      const dstIdx = (y * dw + x) * 4;
      out[dstIdx] = src[srcIdx]!;
      out[dstIdx + 1] = src[srcIdx + 1]!;
      out[dstIdx + 2] = src[srcIdx + 2]!;
      out[dstIdx + 3] = src[srcIdx + 3]!;
    }
  }
  // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by loop and sw/sh
  return out;
}
