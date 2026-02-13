/**
 * Test-only helper: parse JPEG ICC, XMP, and MPF using ExifReader.
 * Use this in unit tests to assert metadata structure without hand-rolled segment parsing.
 * ExifReader is a devDependency; this module is not part of the published bundle.
 */

import { DOMParser } from '@xmldom/xmldom';
import ExifReader, { type Tags } from 'exifreader';

export interface ParsedMpfImage {
  ImageType: number;
  ImageFormat: number;
  ImageSize: number;
  ImageOffset: number;
}

export interface JpegMetadataResult {
  /** Whether an ICC profile segment was found */
  hasIcc: boolean;
  /** Whether XMP was found (e.g. hdrgm) */
  hasXmp: boolean;
  /** MPF image entries when present (primary first, then gain map) */
  mpfImages: ParsedMpfImage[] | null;
  /** Raw ExifReader tags for further assertions */
  tags: Tags;
}

/**
 * Parse JPEG buffer with ExifReader to get ICC, XMP, and MPF metadata.
 * Uses expanded: false so we get flat Tags including Images (MPF).
 */
export function parseJpegMetadataForTests(jpeg: Uint8Array): JpegMetadataResult {
  const ab = jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength);
  const tags = ExifReader.load(ab, {
    includeTags: { file: true, icc: true, xmp: true, exif: true, mpf: true },
    domParser: new DOMParser(),
    async: false,
  });

  const tagKeys = Object.keys(tags);
  const hasIcc = tagKeys.some(
    (k) => k.length > 8 && (k.includes('rofile') || k.includes('Matrix') || k.includes('White')),
  );
  const rawTag = (tags as Record<string, unknown>)._raw;
  const hasXmp = tags.Version !== undefined || (typeof rawTag === 'string' && rawTag.includes('hdrgm'));

  let mpfImages: ParsedMpfImage[] | null = null;
  const tagObj = tags as Record<string, unknown>;
  const images = tagObj.Images as
    | Array<{
        ImageType?: { value: number };
        ImageFormat?: { value: number };
        ImageSize?: { value: number };
        ImageOffset?: { value: number };
      }>
    | undefined;
  if (images && Array.isArray(images) && images.length >= 1) {
    mpfImages = images.map((img) => ({
      ImageType: img.ImageType?.value ?? 0,
      ImageFormat: img.ImageFormat?.value ?? 0,
      ImageSize: img.ImageSize?.value ?? 0,
      ImageOffset: img.ImageOffset?.value ?? 0,
    }));
  }

  return { hasIcc, hasXmp, mpfImages, tags };
}
