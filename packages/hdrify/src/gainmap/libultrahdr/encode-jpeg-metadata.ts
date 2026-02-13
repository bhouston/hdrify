import { assembleJpegAdobeGainMap } from '../adobeGainMapAssembler.js';
import type { GainMapFormat } from '../readJpegGainMap.js';
import type { CompressedImage, GainMapMetadata, GainMapMetadataExtended } from '../types.js';
import { DEFAULT_ICC_PROFILE } from './defaultIccProfile.js';
import { assembleJpegWithGainMap } from './jpeg-assembler.js';

export interface EncodeJPEGMetadataOptions {
  format?: GainMapFormat;
  /** ICC profile (APP2 payload). For ultrahdr, default is sRGB matching reference memorial.jpg. Pass null to omit. */
  icc?: Uint8Array | null;
  /** EXIF (APP1 payload). For ultrahdr, default is null (no EXIF, matches reference). Pass Uint8Array to add. */
  exif?: Uint8Array | null;
}

export function encodeJPEGMetadata(
  encodingResult: GainMapMetadata & { sdr: CompressedImage; gainMap: CompressedImage },
  options: EncodeJPEGMetadataOptions = {},
): Uint8Array {
  const format = options.format ?? 'ultrahdr';
  if (encodingResult.sdr.mimeType !== 'image/jpeg') {
    throw new Error('This function expects an SDR image compressed in jpeg');
  }
  if (encodingResult.gainMap.mimeType !== 'image/jpeg') {
    throw new Error('This function expects a GainMap image compressed in jpeg');
  }

  const metadata: GainMapMetadataExtended = {
    version: '1.0',
    gainMapMin: encodingResult.gainMapMin,
    gainMapMax: encodingResult.gainMapMax,
    gamma: encodingResult.gamma,
    offsetSdr: encodingResult.offsetSdr,
    offsetHdr: encodingResult.offsetHdr,
    hdrCapacityMin: encodingResult.hdrCapacityMin,
    hdrCapacityMax: encodingResult.hdrCapacityMax,
    minContentBoost: Array.isArray(encodingResult.gainMapMin)
      ? 2 ** (encodingResult.gainMapMin.reduce((a, b) => a + b, 0) / encodingResult.gainMapMin.length)
      : 2 ** encodingResult.gainMapMin,
    maxContentBoost: Array.isArray(encodingResult.gainMapMax)
      ? 2 ** (encodingResult.gainMapMax.reduce((a, b) => a + b, 0) / encodingResult.gainMapMax.length)
      : 2 ** encodingResult.gainMapMax,
  };

  if (format === 'adobe-gainmap') {
    return assembleJpegAdobeGainMap({
      sdr: encodingResult.sdr,
      gainMap: encodingResult.gainMap,
      metadata,
    });
  }

  const icc = options.icc !== undefined ? options.icc : DEFAULT_ICC_PROFILE;
  const exif = options.exif ?? null;
  return assembleJpegWithGainMap({
    sdr: encodingResult.sdr,
    gainMap: encodingResult.gainMap,
    metadata,
    ...(exif && exif.length > 0 && { exif }),
    ...(icc && icc.length > 0 && { icc }),
  });
}
