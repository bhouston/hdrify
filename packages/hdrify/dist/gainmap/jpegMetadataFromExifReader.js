/**
 * Test-only helper: parse JPEG ICC, XMP, and MPF using ExifReader.
 * Use this in unit tests to assert metadata structure without hand-rolled segment parsing.
 * ExifReader is a devDependency; this module is not part of the published bundle.
 */
import { DOMParser } from '@xmldom/xmldom';
import ExifReader, {} from 'exifreader';
/**
 * Parse JPEG buffer with ExifReader to get ICC, XMP, and MPF metadata.
 * Uses expanded: false so we get flat Tags including Images (MPF).
 */
export function parseJpegMetadataForTests(jpeg) {
    const ab = jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength);
    const tags = ExifReader.load(ab, {
        includeTags: { file: true, icc: true, xmp: true, exif: true, mpf: true },
        domParser: new DOMParser(),
        async: false,
    });
    const tagKeys = Object.keys(tags);
    const hasIcc = tagKeys.some((k) => k.length > 8 && (k.includes('rofile') || k.includes('Matrix') || k.includes('White')));
    const rawTag = tags._raw;
    const hasXmp = tags.Version !== undefined || (typeof rawTag === 'string' && rawTag.includes('hdrgm'));
    let mpfImages = null;
    const tagObj = tags;
    const images = tagObj.Images;
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
//# sourceMappingURL=jpegMetadataFromExifReader.js.map