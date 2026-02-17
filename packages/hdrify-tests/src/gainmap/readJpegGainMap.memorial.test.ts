import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareImages,
  encodeGainMap,
  encodeToJpeg,
  extractIccProfileFromJpeg,
  readExr,
  readJpegGainMap,
  writeJpegGainMap,
} from 'hdrify';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../../..');
const assetsDir = path.join(workspaceRoot, 'assets');

const memorialExr = path.join(assetsDir, 'memorial.exr');
const memorialJpg = path.join(assetsDir, 'memorial.jpg');

function toUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Extract all XMP XML blocks from a JPEG (each from <x:xmpmeta to </x:xmpmeta>) */
function extractXmpBlocks(jpeg: Uint8Array): string[] {
  const str = new TextDecoder('utf-8', { fatal: false }).decode(jpeg);
  const blocks: string[] = [];
  let start = str.indexOf('<x:xmpmeta');
  while (start !== -1) {
    const end = str.indexOf('</x:xmpmeta>', start);
    if (end === -1) break;
    blocks.push(str.slice(start, end + 12));
    start = str.indexOf('<x:xmpmeta', end);
  }
  return blocks;
}

/** Require primary XMP: Container:Directory, Item:Semantic Primary/GainMap, Item:Length, hdrgm:Version */
function hasPrimaryXmpStructure(xml: string): boolean {
  return (
    xml.includes('Container:Directory') &&
    xml.includes('Item:Semantic="Primary"') &&
    xml.includes('Item:Semantic="GainMap"') &&
    /Item:Length="\d+"/.test(xml) &&
    xml.includes('hdrgm:Version=')
  );
}

/** Require secondary XMP: full hdrgm params for gain map */
function hasSecondaryXmpStructure(xml: string): boolean {
  return (
    xml.includes('hdrgm:GainMapMin=') &&
    xml.includes('hdrgm:GainMapMax=') &&
    xml.includes('hdrgm:Gamma=') &&
    xml.includes('hdrgm:OffsetSDR=') &&
    xml.includes('hdrgm:OffsetHDR=') &&
    xml.includes('hdrgm:HDRCapacityMin=') &&
    xml.includes('hdrgm:HDRCapacityMax=') &&
    xml.includes('hdrgm:BaseRenditionIsHDR="False"')
  );
}

describe('readJpegGainMap', () => {
  describe('throw when no gain map data', () => {
    it('throws when given a plain JPEG (no gain map metadata)', () => {
      const plainJpeg = encodeToJpeg(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1);
      expect(() => readJpegGainMap(plainJpeg.data)).toThrow(/Not a valid JPEG with gain map/);
    });
  });

  describe('memorial assets (smoke)', () => {
    it('loads memorial.exr, memorial.jpg and dimensions match', () => {
      const exr = readExr(toUint8Array(fs.readFileSync(memorialExr)));
      const jpg = readJpegGainMap(toUint8Array(fs.readFileSync(memorialJpg)));
      expect(jpg.width).toBe(exr.width);
      expect(jpg.height).toBe(exr.height);
    });

    it('memorial.jpg result has metadata.format set', () => {
      const jpg = readJpegGainMap(toUint8Array(fs.readFileSync(memorialJpg)));
      expect(jpg.metadata?.format).toBeDefined();
      expect(['ultrahdr', 'adobe-gainmap']).toContain(jpg.metadata?.format);
    });

    it('generated Ultra HDR XMP structure matches reference (Apple Preview recognition)', () => {
      const referenceJpeg = toUint8Array(fs.readFileSync(memorialJpg));
      const refBlocks = extractXmpBlocks(referenceJpeg);
      expect(refBlocks.length).toBeGreaterThanOrEqual(2);
      const refPrimary = refBlocks.find(hasPrimaryXmpStructure);
      const refSecondary = refBlocks.find(hasSecondaryXmpStructure);
      expect(refPrimary, 'reference should have primary XMP (Container + hdrgm:Version)').toBeDefined();
      expect(refSecondary, 'reference should have secondary XMP (hdrgm gain map params)').toBeDefined();
      expect(refPrimary).not.toContain('xpacket');

      const original = readExr(toUint8Array(fs.readFileSync(memorialExr)));
      const encoding = encodeGainMap(original, { toneMapping: 'reinhard' });
      const generatedJpeg = writeJpegGainMap(encoding, { quality: 100 });
      const genBlocks = extractXmpBlocks(generatedJpeg);
      expect(genBlocks.length).toBeGreaterThanOrEqual(2);
      const genPrimary = genBlocks.find(hasPrimaryXmpStructure);
      const genSecondary = genBlocks.find(hasSecondaryXmpStructure);
      expect(genPrimary, 'generated should have primary XMP matching reference structure').toBeDefined();
      expect(genSecondary, 'generated should have secondary XMP matching reference structure').toBeDefined();
      expect(genPrimary).not.toContain('xpacket');
      expect(genSecondary).not.toContain('xpacket');
    });

    it('reference memorial.jpg and generated Ultra HDR JPEG have compatible sRGB ICC profiles', () => {
      const referenceJpeg = toUint8Array(fs.readFileSync(memorialJpg));
      const refProfile = extractIccProfileFromJpeg(referenceJpeg);
      expect(refProfile, 'reference assets/memorial.jpg should have an embedded ICC profile').not.toBeNull();
      if (!refProfile) return;

      const original = readExr(toUint8Array(fs.readFileSync(memorialExr)));
      const encoding = encodeGainMap(original, { toneMapping: 'reinhard' });
      const generatedJpeg = writeJpegGainMap(encoding, { quality: 100 });
      const genProfile = extractIccProfileFromJpeg(generatedJpeg);
      expect(genProfile, 'generated Ultra HDR JPEG should have an embedded ICC profile').not.toBeNull();
      if (!genProfile) return;

      // Both reference and generated use sRGB ICC (reference-compatible for Apple Preview)
      expect(refProfile.length).toBe(456);
      expect(genProfile.length).toBe(456);
      expect(genProfile.length).toBe(refProfile.length);
    });
  });

  describe('gain map round-trip (read → encode → write → read, full decode/re-encode)', () => {
    it.skip('EXR → gain map → read → encode (no metadata reuse) → write → read: second read matches first read within tolerance', () => {
      const TOLERANCE_ROUNDTRIP = { toleranceRelative: 0.15, toleranceAbsolute: 0.01 };

      const original = readExr(toUint8Array(fs.readFileSync(memorialExr)));
      const encoding = encodeGainMap(original, { toneMapping: 'reinhard' });
      const jpegBuffer = writeJpegGainMap(encoding, { quality: 100 });

      const firstRead = readJpegGainMap(jpegBuffer);
      const reEncode = encodeGainMap(firstRead, { toneMapping: 'reinhard' });
      const jpegBuffer2 = writeJpegGainMap(reEncode, { quality: 100 });
      const secondRead = readJpegGainMap(jpegBuffer2);

      const result = compareImages(firstRead, secondRead, TOLERANCE_ROUNDTRIP);
      expect(
        result.match,
        `Full round-trip (decode→re-encode): maxRelativeDelta=${result.maxRelativeDelta} maxAbsoluteDelta=${result.maxAbsoluteDelta} mismatchedPixels=${result.mismatchedPixels}`,
      ).toBe(true);
    });
  });

  describe('EXR → gain map → read (pipeline we control)', () => {
    it.skip('load memorial.exr, encode to gain map, write, read back; decoded matches original EXR within tolerance', () => {
      const original = readExr(toUint8Array(fs.readFileSync(memorialExr)));
      const encoding = encodeGainMap(original, { toneMapping: 'reinhard' });
      const jpegBuffer = writeJpegGainMap(encoding, { quality: 100 });
      const decoded = readJpegGainMap(jpegBuffer);

      const TOLERANCE_ROUNDTRIP = { toleranceRelative: 0.15, toleranceAbsolute: 0.01 };

      const result = compareImages(original, decoded, TOLERANCE_ROUNDTRIP);
      expect(
        result.match,
        `EXR→gain map→read: maxRelativeDelta=${result.maxRelativeDelta} maxAbsoluteDelta=${result.maxAbsoluteDelta} mismatchedPixels=${result.mismatchedPixels}`,
      ).toBe(true);
    });
  });
});
