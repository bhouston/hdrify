/**
 * Extract SDR and gain map image blobs from a JPEG-R buffer using MPF (Multi-Picture Format).
 * Supports CIPA DC-007 layout (our writer) and fixed 60-byte layout (UltraHDRLoader).
 * Throws if primary or gain map image cannot be extracted.
 */

const MARKER_PREFIX = 0xff;
const APP2 = 0xe2;
const MPF_SIGNATURE = 0x4d504600; // "MPF\0"
const MP_ENTRY_TAG = 0xb002;
const MP_ENTRY_SIZE = 16;

const GAIN_MAP_IMAGE_ERROR = 'Not a valid JPEG with gain map: missing gain map image';

export interface MpfExtractResult {
  primaryImage: Uint8Array;
  gainmapImage: Uint8Array;
  /** Format hint: 'ultrahdr' when structure matches UltraHDR/JPEG-R */
  format: 'ultrahdr' | 'adobe-gainmap';
}

/**
 * Segment-walk: find APP2 with MPF signature, then parse MP entries to get primary
 * and gain map byte ranges. Returns JPEG blobs each starting with SOI (0xFF 0xD8).
 */
export function extractImagesFromMpf(buffer: Uint8Array): MpfExtractResult {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  if (view.getUint16(0, false) !== 0xffd8) {
    throw new Error(GAIN_MAP_IMAGE_ERROR);
  }

  let offset = 2;
  let primaryImage: Uint8Array | null = null;
  let gainmapImage: Uint8Array | null = null;
  const format: 'ultrahdr' | 'adobe-gainmap' = 'ultrahdr';

  while (offset < buffer.length - 1) {
    if (view.getUint8(offset) !== MARKER_PREFIX) {
      offset += 1;
      continue;
    }

    const marker = view.getUint8(offset + 1);

    if (marker === APP2) {
      const segmentLength = view.getUint16(offset + 2, false);
      const segmentEnd = offset + 2 + segmentLength;
      const payloadStart = offset + 4;

      if (segmentLength >= 4 && view.getUint32(payloadStart, false) === MPF_SIGNATURE) {
        const payload = buffer.subarray(payloadStart, segmentEnd);
        const payloadView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

        const le = payloadView.getUint32(6, false) === 0x49492a00;
        const bigEndian = !le;

        let primarySize: number;
        let primaryOffset: number;
        let gainmapSize: number;
        let gainmapOffsetInFile: number;

        const mpEntryOffset = findMpEntryOffset(payloadView, bigEndian);
        if (mpEntryOffset !== null && payload.length >= mpEntryOffset + 2 * MP_ENTRY_SIZE) {
          primarySize = payloadView.getUint32(mpEntryOffset + 4, bigEndian);
          primaryOffset = payloadView.getUint32(mpEntryOffset + 8, bigEndian);
          gainmapSize = payloadView.getUint32(mpEntryOffset + 20, bigEndian);
          const gainmapStored = payloadView.getUint32(mpEntryOffset + 24, bigEndian);
          const relativeOffset = gainmapStored + offset + 6;
          gainmapOffsetInFile =
            relativeOffset >= 0 && relativeOffset + gainmapSize <= buffer.length ? relativeOffset : gainmapStored;
        } else {
          const fixed60 = 60;
          if (payload.length < fixed60 + 2 * MP_ENTRY_SIZE) {
            offset = segmentEnd;
            continue;
          }
          primarySize = payloadView.getUint32(fixed60, bigEndian);
          primaryOffset = payloadView.getUint32(fixed60 + 4, bigEndian);
          gainmapSize = payloadView.getUint32(fixed60 + 16, bigEndian);
          const gainmapStored = payloadView.getUint32(fixed60 + 20, bigEndian);
          const relativeOffset = gainmapStored + offset + 6;
          gainmapOffsetInFile =
            relativeOffset >= 0 && relativeOffset + gainmapSize <= buffer.length ? relativeOffset : gainmapStored;
        }

        if (primaryOffset >= buffer.length || primaryOffset + primarySize > buffer.length) {
          offset = segmentEnd;
          continue;
        }
        if (gainmapOffsetInFile >= buffer.length || gainmapOffsetInFile + gainmapSize > buffer.length) {
          offset = segmentEnd;
          continue;
        }

        primaryImage = buffer.subarray(primaryOffset, primaryOffset + primarySize);
        gainmapImage = buffer.subarray(gainmapOffsetInFile, gainmapOffsetInFile + gainmapSize);

        if (primaryImage[0] !== MARKER_PREFIX || primaryImage[1] !== 0xd8) {
          const withSoi = new Uint8Array(2 + primaryImage.length);
          withSoi[0] = MARKER_PREFIX;
          withSoi[1] = 0xd8;
          withSoi.set(primaryImage, 2);
          primaryImage = withSoi;
        }
        if (gainmapImage[0] !== MARKER_PREFIX || gainmapImage[1] !== 0xd8) {
          const withSoi = new Uint8Array(2 + gainmapImage.length);
          withSoi[0] = MARKER_PREFIX;
          withSoi[1] = 0xd8;
          withSoi.set(gainmapImage, 2);
          gainmapImage = withSoi;
        }

        break;
      }

      offset = segmentEnd;
      continue;
    }

    if (marker >= 0xc0 && marker <= 0xfe && marker !== 0xd9 && (marker < 0xd0 || marker > 0xd7)) {
      const segmentLength = view.getUint16(offset + 2, false);
      offset += 2 + segmentLength;
      continue;
    }

    offset += 2;
  }

  if (!primaryImage || !gainmapImage) {
    throw new Error(GAIN_MAP_IMAGE_ERROR);
  }

  return { primaryImage, gainmapImage, format };
}

const SOI_MARKER = 0xd8;

const EOI_MARKER = 0xd9;

/**
 * Fallback when MPF is not present: find the second SOI (0xFF 0xD8).
 * Prefer one that immediately follows EOI (0xFF 0xD9); otherwise use first SOI after byte 2.
 * Primary = 0 to second SOI; gain map = second SOI to end.
 */
export function extractImagesBySecondSoi(buffer: Uint8Array): MpfExtractResult {
  if (buffer.length < 4 || buffer[0] !== MARKER_PREFIX || buffer[1] !== SOI_MARKER) {
    throw new Error(GAIN_MAP_IMAGE_ERROR);
  }
  let secondSoiAfterEoi = -1;
  let firstSecondSoi = -1;
  for (let i = 2; i < buffer.length - 1; i++) {
    if (buffer[i] === MARKER_PREFIX && buffer[i + 1] === SOI_MARKER) {
      if (firstSecondSoi < 0) firstSecondSoi = i;
      if (i >= 2 && buffer[i - 2] === MARKER_PREFIX && buffer[i - 1] === EOI_MARKER) {
        secondSoiAfterEoi = i;
        break;
      }
    }
  }
  const secondSoi = secondSoiAfterEoi >= 0 ? secondSoiAfterEoi : firstSecondSoi;
  if (secondSoi < 0) {
    throw new Error(GAIN_MAP_IMAGE_ERROR);
  }
  const primaryImage = buffer.subarray(0, secondSoi);
  const gainmapImage = buffer.subarray(secondSoi);
  return {
    primaryImage,
    gainmapImage,
    format: 'ultrahdr',
  };
}

function findMpEntryOffset(payloadView: DataView, bigEndian: boolean): number | null {
  const ifdOffset = payloadView.getUint32(8, bigEndian);
  if (payloadView.byteLength < ifdOffset + 2) return null;
  const tagCount = payloadView.getUint16(ifdOffset, bigEndian);
  for (let i = 0; i < tagCount; i++) {
    const tagStart = ifdOffset + 2 + i * 12;
    if (payloadView.byteLength < tagStart + 12) return null;
    const tagId = payloadView.getUint16(tagStart, bigEndian);
    if (tagId === MP_ENTRY_TAG) {
      return payloadView.getUint32(tagStart + 8, bigEndian);
    }
  }
  return null;
}
