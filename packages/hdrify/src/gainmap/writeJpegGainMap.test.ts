import { describe, expect, it } from 'vitest';
import { encodeGainMap } from './gainMapEncoder.js';
import { DEFAULT_ICC_PROFILE } from './libultrahdr/defaultIccProfile.js';
import { extractIccProfileFromJpeg } from './libultrahdr/iccFromJpeg.js';
import { MARKERS } from './libultrahdr/jpeg-markers.js';
import { writeGainMapAsSeparateFiles, writeJpegGainMap } from './writeJpegGainMap.js';

const SOI = 0xd8;
const MARKER_PREFIX = 0xff;

/** Parse MPF payload to get MPImage2 offset (relative to mpfBase) and size. MPF base = mpfSegmentStart + 8. */
function parseMpfImage2Offset(mpfPayload: Uint8Array): { offset: number; size: number } | null {
  if (mpfPayload.length < 4 + 8 + 2) return null;
  const le = mpfPayload[4] === 0x49 && mpfPayload[5] === 0x49;
  const b = (o: number) => mpfPayload[o] ?? 0;
  const getU32 = (o: number) =>
    le
      ? b(o) | (b(o + 1) << 8) | (b(o + 2) << 16) | (b(o + 3) << 24)
      : (b(o) << 24) | (b(o + 1) << 16) | (b(o + 2) << 8) | b(o + 3);

  // B002 contains the MP entry list offset; parse it instead of hard-coding.
  const tiffStart = 4;
  const ifd0Offset = getU32(tiffStart + 4);
  const ifd0Pos = tiffStart + ifd0Offset;
  if (ifd0Pos + 2 > mpfPayload.length) return null;
  const entryCount = le ? b(ifd0Pos) | (b(ifd0Pos + 1) << 8) : (b(ifd0Pos) << 8) | b(ifd0Pos + 1);
  let mpEntryOffset = -1;
  for (let i = 0; i < entryCount; i++) {
    const entryPos = ifd0Pos + 2 + i * 12;
    if (entryPos + 12 > mpfPayload.length) return null;
    const tag = le ? b(entryPos) | (b(entryPos + 1) << 8) : (b(entryPos) << 8) | b(entryPos + 1);
    if (tag === 0xb002) {
      mpEntryOffset = getU32(entryPos + 8);
      break;
    }
  }
  if (mpEntryOffset < 0) return null;

  const mpEntriesStart = tiffStart + mpEntryOffset;
  if (mpfPayload.length < mpEntriesStart + 32) return null;
  const img2Size = getU32(mpEntriesStart + 16 + 4);
  const img2Offset = getU32(mpEntriesStart + 16 + 8);
  return { offset: img2Offset, size: img2Size };
}

/** Scan JPEG for APP2 segments; returns { mpfOffset, mpfPayload, iccOffset, iccPayload } (first of each). */
function findApp2Segments(jpeg: Uint8Array): {
  mpfOffset: number;
  mpfPayload: Uint8Array;
  iccOffset: number;
  iccPayload: Uint8Array;
} | null {
  const MPF_SIG = [0x4d, 0x50, 0x46, 0x00]; // "MPF\0"
  const ICC_SIG = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00]; // "ICC_PROFILE\0"
  let mpfOffset = -1;
  let mpfPayload: Uint8Array | null = null;
  let iccOffset = -1;
  let iccPayload: Uint8Array | null = null;
  let i = 0;
  while (i < jpeg.length - 1) {
    if (i + 4 > jpeg.length || jpeg[i] !== 0xff || jpeg[i + 1] !== MARKERS.APP2) {
      i += 1;
      continue;
    }
    const segStart = i;
    const len = ((jpeg[i + 2] ?? 0) << 8) | (jpeg[i + 3] ?? 0);
    const payloadStart = i + 4;
    const payload = jpeg.subarray(payloadStart, payloadStart + len - 2);
    if (payload.length >= MPF_SIG.length && MPF_SIG.every((b, j) => payload[j] === b)) {
      if (mpfOffset === -1) {
        mpfOffset = segStart;
        mpfPayload = payload;
      }
    }
    if (payload.length >= ICC_SIG.length && ICC_SIG.every((b, j) => payload[j] === b)) {
      if (iccOffset === -1) {
        iccOffset = segStart;
        iccPayload = payload;
      }
    }
    i = payloadStart + len - 2;
  }
  if (mpfOffset === -1 || !mpfPayload || iccOffset === -1 || !iccPayload) return null;
  return { mpfOffset, mpfPayload, iccOffset, iccPayload };
}

const smallImage = {
  width: 4,
  height: 4,
  linearColorSpace: 'linear-rec709' as const,
  data: new Float32Array(4 * 4 * 4).fill(1),
};
// Set some variation for proper encoding
smallImage.data.set([2, 2, 2, 1], 0);
smallImage.data.set([0.5, 0.5, 0.5, 1], 16);

describe('writeJpegGainMap', () => {
  it('should produce valid JPEG-R file', () => {
    const encodingResult = encodeGainMap(smallImage);
    const jpegR = writeJpegGainMap(encodingResult);

    expect(jpegR).toBeInstanceOf(Uint8Array);
    expect(jpegR.length).toBeGreaterThan(100);
    expect(jpegR[0]).toBe(0xff);
    expect(jpegR[1]).toBe(0xd8);
  });

  it('should embed default ICC profile in ultrahdr output for Apple Preview 10-bit recognition', () => {
    const encodingResult = encodeGainMap(smallImage);
    const jpegR = writeJpegGainMap(encodingResult);
    const hasIcc = new TextDecoder('latin1').decode(jpegR).includes('ICC_PROFILE');
    expect(hasIcc).toBe(true);
  });

  it('should embed sRGB ICC profile (reference-compatible for Apple Preview)', () => {
    const encodingResult = encodeGainMap(smallImage);
    const jpegR = writeJpegGainMap(encodingResult);
    const profile = extractIccProfileFromJpeg(jpegR);
    expect(profile).not.toBeNull();
    if (!profile) return;
    // Default is sRGB matching reference memorial.jpg; same size as embedded profile
    const defaultProfile = DEFAULT_ICC_PROFILE.subarray(14);
    expect(profile.length).toBe(defaultProfile.length);
    expect(profile.length).toBe(456); // sRGB profile size
  });

  it('should omit ICC when icc: null', () => {
    const encodingResult = encodeGainMap(smallImage);
    const jpegR = writeJpegGainMap(encodingResult, { icc: null });
    const hasIcc = new TextDecoder('latin1').decode(jpegR).includes('ICC_PROFILE');
    expect(hasIcc).toBe(false);
  });

  it('should omit EXIF by default (matches reference memorial.jpg)', () => {
    const encodingResult = encodeGainMap(smallImage);
    const jpegR = writeJpegGainMap(encodingResult);
    const str = new TextDecoder('latin1').decode(jpegR);
    expect(str).not.toContain('Exif\x00\x00');
  });

  it('should omit EXIF when exif: null', () => {
    const encodingResult = encodeGainMap(smallImage);
    const jpegR = writeJpegGainMap(encodingResult, { exif: null });
    const str = new TextDecoder('latin1').decode(jpegR);
    expect(str).not.toContain('Exif\x00\x00');
  });

  it('should accept quality option', () => {
    const encodingResult = encodeGainMap(smallImage);
    const jpegRDefault = writeJpegGainMap(encodingResult);
    const jpegRHigh = writeJpegGainMap(encodingResult, { quality: 95 });
    const jpegRLow = writeJpegGainMap(encodingResult, { quality: 50 });

    expect(jpegRHigh.length).toBeGreaterThanOrEqual(jpegRLow.length);
    expect(jpegRDefault.length).toBeGreaterThan(0);
  });

  it('should produce valid adobe-gainmap format and round-trip', async () => {
    const { readJpegGainMap } = await import('./readJpegGainMap.js');
    const { compareImages } = await import('../synthetic/compareImages.js');
    const encodingResult = encodeGainMap(smallImage);
    const jpegAdobe = writeJpegGainMap(encodingResult, { format: 'adobe-gainmap', quality: 100 });

    expect(jpegAdobe).toBeInstanceOf(Uint8Array);
    expect(jpegAdobe.length).toBeGreaterThan(100);
    expect(jpegAdobe[0]).toBe(0xff);
    expect(jpegAdobe[1]).toBe(0xd8);

    const decoded = readJpegGainMap(jpegAdobe);
    expect(decoded.width).toBe(smallImage.width);
    expect(decoded.height).toBe(smallImage.height);
    expect(decoded.metadata?.format).toBeDefined();

    const result = compareImages(smallImage, decoded, {
      toleranceRelative: 0.005,
      toleranceAbsolute: 0.005,
    });
    expect(
      result.match,
      `Adobe round-trip: maxAbsoluteDelta=${result.maxAbsoluteDelta} mismatchedPixels=${result.mismatchedPixels}`,
    ).toBe(true);
  });

  describe('ultrahdr structure (Apple Preview compatibility)', () => {
    it('should expose ICC and XMP to ExifReader (library-backed metadata check)', async () => {
      const { parseJpegMetadataForTests } = await import('./jpegMetadataFromExifReader.js');
      const encodingResult = encodeGainMap(smallImage);
      const jpegR = writeJpegGainMap(encodingResult);
      const parsed = parseJpegMetadataForTests(jpegR);
      expect(parsed.hasIcc, 'Ultra HDR output should embed ICC for Apple Preview').toBe(true);
      expect(parsed.hasXmp, 'Ultra HDR output should embed XMP (hdrgm) for gain map').toBe(true);
    });

    it('should place MPF segment before ICC segment in primary image', () => {
      const encodingResult = encodeGainMap(smallImage);
      const jpegR = writeJpegGainMap(encodingResult);
      const segments = findApp2Segments(jpegR);
      expect(segments).not.toBeNull();
      if (!segments) return;
      expect(segments.mpfOffset, 'MPF APP2 must appear before ICC APP2 for Apple Preview').toBeLessThan(
        segments.iccOffset,
      );
    });

    it('should use Little Endian in MPF (II) for Apple Preview', () => {
      const encodingResult = encodeGainMap(smallImage);
      const jpegR = writeJpegGainMap(encodingResult);
      const segments = findApp2Segments(jpegR);
      expect(segments).not.toBeNull();
      if (!segments) return;
      // Bytes 4-5 of MPF payload are endianness: 0x49 0x49 = "II" = Little Endian
      expect(segments.mpfPayload[4]).toBe(0x49);
      expect(segments.mpfPayload[5]).toBe(0x49);
    });

    it('should set primary image MP entry type to Baseline MP Primary Image (0x030000)', async () => {
      const encodingResult = encodeGainMap(smallImage);
      const jpegR = writeJpegGainMap(encodingResult);
      const BASELINE_MP_PRIMARY = 0x00030000;
      // Prefer ExifReader when it returns MPF Images (library-backed assertion)
      const { parseJpegMetadataForTests } = await import('./jpegMetadataFromExifReader.js');
      const parsed = parseJpegMetadataForTests(jpegR);
      if (parsed.mpfImages && parsed.mpfImages.length >= 1) {
        const primary = parsed.mpfImages[0];
        expect(primary).toBeDefined();
        if (!primary) return;
        expect(
          primary.ImageType,
          'Primary image type must be Baseline MP Primary Image (0x030000) for Apple Preview',
        ).toBe(BASELINE_MP_PRIMARY);
        return;
      }
      // Fallback: assert the type bytes (0x00030000 LE) appear in the MPF payload
      const segments = findApp2Segments(jpegR);
      expect(segments).not.toBeNull();
      if (!segments) return;
      const payload = segments.mpfPayload;
      const hasSequence = Array.from({ length: payload.length - 3 }).some(
        (_, i) => payload[i] === 0x00 && payload[i + 1] === 0x00 && payload[i + 2] === 0x03 && payload[i + 3] === 0x00,
      );
      expect(
        hasSequence,
        'MPF payload must contain Baseline MP Primary Image type (0x00030000) for Apple Preview',
      ).toBe(true);
    });

    it('should have MPImage2 offset pointing to JPEG SOI (valid gain map linkage)', () => {
      const encodingResult = encodeGainMap(smallImage);
      const jpegR = writeJpegGainMap(encodingResult);
      const segments = findApp2Segments(jpegR);
      expect(segments).not.toBeNull();
      if (!segments) return;
      const parsed = parseMpfImage2Offset(segments.mpfPayload);
      expect(parsed).not.toBeNull();
      if (!parsed) return;
      const mpfBase = segments.mpfOffset + 8;
      const absOffset = mpfBase + parsed.offset;
      expect(
        jpegR[absOffset],
        `MPImage2 offset must point to SOI (0xFF); at ${absOffset} got 0x${jpegR[absOffset]?.toString(16) ?? '?'}`,
      ).toBe(MARKER_PREFIX);
      expect(
        jpegR[absOffset + 1],
        `MPImage2 offset+1 must be 0xD8; at ${absOffset + 1} got 0x${jpegR[absOffset + 1]?.toString(16) ?? '?'}`,
      ).toBe(SOI);
    });

    it('should produce valid gain map JPEG extractable at MPImage2 offset', () => {
      const encodingResult = encodeGainMap(smallImage);
      const jpegR = writeJpegGainMap(encodingResult);
      const segments = findApp2Segments(jpegR);
      expect(segments).not.toBeNull();
      if (!segments) return;
      const parsed = parseMpfImage2Offset(segments.mpfPayload);
      expect(parsed).not.toBeNull();
      if (!parsed) return;
      const mpfBase = segments.mpfOffset + 8;
      const absOffset = mpfBase + parsed.offset;
      const gainMapBytes = jpegR.subarray(absOffset, absOffset + parsed.size);
      expect(gainMapBytes[0]).toBe(MARKER_PREFIX);
      expect(gainMapBytes[1]).toBe(SOI);
      expect(gainMapBytes.length).toBe(parsed.size);
    });
  });
});

describe('writeGainMapAsSeparateFiles', () => {
  it('should produce SDR JPEG, gain map JPEG, and metadata', () => {
    const encodingResult = encodeGainMap(smallImage);
    const result = writeGainMapAsSeparateFiles(encodingResult);

    expect(result.sdrImage).toBeInstanceOf(Uint8Array);
    expect(result.gainMapImage).toBeInstanceOf(Uint8Array);
    expect(result.metadata).toBeDefined();
    expect(result.sdrImage[0]).toBe(0xff);
    expect(result.sdrImage[1]).toBe(0xd8);
    expect(result.gainMapImage[0]).toBe(0xff);
    expect(result.gainMapImage[1]).toBe(0xd8);
    expect(result.metadata.gamma).toBeDefined();
    expect(result.metadata.gainMapMin).toBeDefined();
    expect(result.metadata.gainMapMax).toBeDefined();
  });

  it('should accept quality option', () => {
    const encodingResult = encodeGainMap(smallImage);
    const result = writeGainMapAsSeparateFiles(encodingResult, { quality: 80 });

    expect(result.sdrImage.length).toBeGreaterThan(0);
    expect(result.gainMapImage.length).toBeGreaterThan(0);
  });
});
