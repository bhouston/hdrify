import { encodeToJpeg } from './jpegEncoder.js';
import { gainMapIccPayloads, insertJpegIcc, type GainMapIccOptions } from './libultrahdr/gainMapIccMetadata.js';
import { encodeJPEGMetadata } from './libultrahdr/encode-jpeg-metadata.js';
import type { GainMapFormat } from './readJpegGainMap.js';
import type { EncodingResult, GainMapMetadata } from './types.js';

export interface GainMapWriterOptions extends GainMapIccOptions {
  /** JPEG quality 0-100. Default: 90 */
  quality?: number;
  /** Output format: ultrahdr (default) or adobe-gainmap */
  format?: GainMapFormat;
  /** EXIF (APP1 payload). For ultrahdr, default is null (no EXIF, matches reference). Pass Uint8Array to add. */
  exif?: Uint8Array | null;
}

/**
 * Write an {@link encodeGainMap} result as a single JPEG-R file with an embedded gain map.
 * Both Ultra HDR and Adobe gain-map layouts support the ICC options on {@link GainMapWriterOptions}.
 * The base is always sRGB, so a supplied profile must describe sRGB; other profiles throw.
 *
 * @param encodingResult - SDR base, gain map, and reconstruction metadata.
 * @param options - JPEG quality, layout, and optional ICC/EXIF metadata.
 * @returns Complete JPEG-R file bytes.
 */
export function writeJpegGainMap(encodingResult: EncodingResult, options: GainMapWriterOptions = {}): Uint8Array {
  const quality = options.quality ?? 90;
  const format = options.format ?? 'ultrahdr';

  const sdrCompressed = encodeToJpeg(encodingResult.sdr, encodingResult.width, encodingResult.height, quality);
  const gainMapCompressed = encodeToJpeg(encodingResult.gainMap, encodingResult.width, encodingResult.height, quality);

  return encodeJPEGMetadata(
    {
      ...encodingResult.metadata,
      sdr: sdrCompressed,
      gainMap: gainMapCompressed,
    },
    { format, icc: options.icc, iccProfile: options.iccProfile, exif: options.exif },
  );
}

export interface SeparateFilesResult {
  sdrImage: Uint8Array;
  gainMapImage: Uint8Array;
  metadata: GainMapMetadata;
}

/**
 * Write an {@link encodeGainMap} result as separate SDR JPEG, gain-map JPEG, and metadata.
 * ICC options follow {@link GainMapWriterOptions}; the profile is embedded only in the SDR JPEG.
 * The profile must describe sRGB, and the gain-map JPEG has no ICC profile.
 *
 * @param encodingResult - SDR base, gain map, and reconstruction metadata.
 * @param options - JPEG quality and ICC metadata options.
 * @returns Two JPEG byte arrays and a metadata object that can be serialized as JSON.
 */
export function writeGainMapAsSeparateFiles(
  encodingResult: EncodingResult,
  options: GainMapWriterOptions = {},
): SeparateFilesResult {
  const quality = options.quality ?? 90;

  const sdrImage = insertJpegIcc(
    encodeToJpeg(encodingResult.sdr, encodingResult.width, encodingResult.height, quality).data,
    gainMapIccPayloads(options),
  );
  const gainMapImage = encodeToJpeg(encodingResult.gainMap, encodingResult.width, encodingResult.height, quality).data;

  return {
    sdrImage,
    gainMapImage,
    metadata: encodingResult.metadata,
  };
}
