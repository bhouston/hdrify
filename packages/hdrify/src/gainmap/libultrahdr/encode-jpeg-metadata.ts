import { assembleJpegAdobeGainMap } from '../adobeGainMapAssembler.js';
import type { GainMapFormat } from '../readJpegGainMap.js';
import type { CompressedImage, GainMapMetadata, GainMapMetadataExtended } from '../types.js';
import { gainMapIccPayloads, type GainMapIccOptions } from './gainMapIccMetadata.js';
import { extractIccProfileFromJpeg } from './iccFromJpeg.js';
import { assembleJpegWithGainMap } from './jpeg-assembler.js';

export interface EncodeJPEGMetadataOptions extends GainMapIccOptions {
  format?: GainMapFormat;
  /** EXIF (APP1 payload). For ultrahdr, default is null (no EXIF, matches reference). Pass Uint8Array to add. */
  exif?: Uint8Array | null;
}

/** Primary JPEG must be untagged; ICC metadata is supplied through options. */
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

  if (extractIccProfileFromJpeg(encodingResult.sdr.data)) {
    throw new Error('Primary JPEG already contains ICC data; supply an untagged JPEG and use ICC options');
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

  const iccPayloads = gainMapIccPayloads(options);
  if (format === 'adobe-gainmap') {
    return assembleJpegAdobeGainMap({
      sdr: encodingResult.sdr,
      gainMap: encodingResult.gainMap,
      metadata,
      iccPayloads,
    });
  }

  const exif = options.exif ?? null;
  return assembleJpegWithGainMap({
    sdr: encodingResult.sdr,
    gainMap: encodingResult.gainMap,
    metadata,
    ...(exif && exif.length > 0 && { exif }),
    iccPayloads,
  });
}
