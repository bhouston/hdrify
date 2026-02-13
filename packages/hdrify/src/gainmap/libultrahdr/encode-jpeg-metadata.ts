import { assembleJpegAdobeGainMap } from '../adobeGainMapAssembler.js';
import type { GainMapFormat } from '../readJpegGainMap.js';
import type { CompressedImage, GainMapMetadata, GainMapMetadataExtended } from '../types.js';
import { assembleJpegWithGainMap } from './jpeg-assembler.js';

export interface EncodeJPEGMetadataOptions {
  format?: GainMapFormat;
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

  return assembleJpegWithGainMap({
    sdr: encodingResult.sdr,
    gainMap: encodingResult.gainMap,
    metadata,
  });
}
