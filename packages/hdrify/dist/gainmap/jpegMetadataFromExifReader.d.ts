/**
 * Test-only helper: parse JPEG ICC, XMP, and MPF using ExifReader.
 * Use this in unit tests to assert metadata structure without hand-rolled segment parsing.
 * ExifReader is a devDependency; this module is not part of the published bundle.
 */
import { type Tags } from 'exifreader';
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
export declare function parseJpegMetadataForTests(jpeg: Uint8Array): JpegMetadataResult;
