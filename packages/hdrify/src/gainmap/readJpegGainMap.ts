/**
 * Read JPEG with embedded gain map (JPEG-R / Ultra HDR) into HdrifyImage.
 * Throws if the buffer does not contain valid gain map metadata or both SDR and gain map images.
 */

import './ensureBuffer.js';
import { iccLinearRgb } from '../color/iccPolicy.js';
import { applyMatrix3ToFloat32Array } from '../color/matrixConversion.js';
import { extractIccProfileFromJpeg } from './libultrahdr/iccFromJpeg.js';
import { decode as jpegDecode } from 'jpeg-js';
import { ensureNonNegativeFinite, type HdrifyImage } from '../hdrifyImage.js';
import { decodeGainMapCpu } from './readJpegGainMap/decodeGainMapCpu.js';
import { extractGainMapXmp } from './readJpegGainMap/extractXmp.js';
import { extractImagesBySecondSoi, extractImagesFromMpf } from './readJpegGainMap/mpfExtractor.js';

export type GainMapFormat = 'ultrahdr' | 'adobe-gainmap';

/**
 * Read a JPEG buffer that contains embedded gain map (XMP + MPF) and return
 * decoded HDR as HdrifyImage. Supports UltraHDR/JPEG-R layout.
 * The base image's embedded ICC profile is colour-managed with the same policy as JPEG XL: recognized
 * cICP, matrix/TRC RGB and gray TRC profiles are evaluated, and LUT-based, CMYK, Lab and other profiles
 * throw. The gain is applied in the base's linear primaries (hdrgm XMP metadata always uses the base colour
 * space, as in libultrahdr), then the result is returned in the matching linear colour space (`linear-rec709`,
 * `linear-p3` or `linear-rec2020`), or Bradford-adapted to `linear-rec2020` for other primaries.
 * Without a profile the base is sRGB, as Ultra HDR specifies. The profile bytes are retained verbatim in
 * `metadata.iccProfile`. An ICC profile on the gain-map image is not used.
 *
 * @param buffer - Full JPEG-R file bytes
 * @returns HdrifyImage with linear HDR RGBA; metadata.format is 'ultrahdr' or 'adobe-gainmap'
 * @throws If no gain map XMP is found, if primary/gain map images cannot be extracted, or if the base
 * image's ICC profile is malformed or cannot be colour-managed
 */
export function readJpegGainMap(buffer: Uint8Array): HdrifyImage {
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

  const iccProfile = extractIccProfileFromJpeg(primaryImage);
  const base = iccProfile ? iccLinearRgb(iccProfile, 'Gain map JPEG') : undefined;

  const sdrDecoded = jpegDecode(primaryImage, { useTArray: true, formatAsRGBA: true });
  const gainDecoded = jpegDecode(gainmapImage, { useTArray: true, formatAsRGBA: true });

  const width = sdrDecoded.width;
  const height = sdrDecoded.height;
  const sdrData = new Uint8ClampedArray(sdrDecoded.data);
  let gainData = new Uint8ClampedArray(gainDecoded.data);

  if (sdrDecoded.width !== gainDecoded.width || sdrDecoded.height !== gainDecoded.height) {
    gainData = new Uint8ClampedArray(
      scaleToSize(gainDecoded.data, gainDecoded.width, gainDecoded.height, width, height),
    );
  }

  const result = decodeGainMapCpu(sdrData, gainData, width, height, metadata, {}, base?.decode);
  if (base?.toOutput) applyMatrix3ToFloat32Array(result.data, base.toOutput);
  if (base) result.linearColorSpace = base.space;

  result.metadata = {
    ...metadata,
    format,
    ...(iccProfile && { iccProfile: new Uint8Array(iccProfile) }),
  };

  ensureNonNegativeFinite(result.data);
  return result;
}

function scaleToSize(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
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
  return out;
}
