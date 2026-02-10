import { encodeToJpeg } from './jpegEncoder.js';
import { encodeJPEGMetadata } from './libultrahdr/index.js';
import type { EncodingResult, GainMapMetadata } from './types.js';

export interface GainMapWriterOptions {
  /** JPEG quality 0-100. Default: 90 */
  quality?: number;
}

/**
 * Write encoding result as a single JPEG-R file (JPEG with embedded gain map).
 */
export function writeGainMapAsJPEGR(encodingResult: EncodingResult, options: GainMapWriterOptions = {}): Uint8Array {
  const quality = options.quality ?? 90;

  const sdrCompressed = encodeToJpeg(encodingResult.sdr, encodingResult.width, encodingResult.height, quality);
  const gainMapCompressed = encodeToJpeg(encodingResult.gainMap, encodingResult.width, encodingResult.height, quality);

  return encodeJPEGMetadata({
    ...encodingResult.metadata,
    sdr: sdrCompressed,
    gainMap: gainMapCompressed,
  });
}

export interface SeparateFilesResult {
  sdrImage: Uint8Array;
  gainMapImage: Uint8Array;
  metadata: GainMapMetadata;
}

/**
 * Write encoding result as separate files: SDR JPEG, gain map JPEG, and metadata JSON.
 */
export function writeGainMapAsSeparateFiles(
  encodingResult: EncodingResult,
  options: GainMapWriterOptions = {},
): SeparateFilesResult {
  const quality = options.quality ?? 90;

  const sdrImage = encodeToJpeg(encodingResult.sdr, encodingResult.width, encodingResult.height, quality).data;
  const gainMapImage = encodeToJpeg(encodingResult.gainMap, encodingResult.width, encodingResult.height, quality).data;

  return {
    sdrImage,
    gainMapImage,
    metadata: encodingResult.metadata,
  };
}
