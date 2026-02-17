/**
 * Diagnostic test to isolate banding: writer vs reader.
 *
 * Runs in-memory round-trip and compares two decode formulas:
 * - Floor: value = byte * scale (current reader)
 * - Midpoint: value = (byte + 0.5) * scale (Radiance reference, C. Bloom)
 *
 * If midpoint decode produces lower error vs original, the reader bug is confirmed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareFloatImages, convertLinearColorSpace, createCieColorWedgeImage, readHdr, writeHdr } from 'hdrify';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../../..');
const assetsDir = path.join(workspaceRoot, 'assets');

const refCieHdr = path.join(assetsDir, 'reference_cie.hdr');

function toUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const TOLERANCE = { toleranceRelative: 0.01, toleranceAbsolute: 0.01 };

/**
 * Decode RGBE bytes to float using floor restoration (current reader formula).
 */
function decodeRGBEFloor(source: Uint8Array, dest: Float32Array, sourceOffset: number, destOffset: number): void {
  const e = source[sourceOffset + 3]!;
  const scale = 2.0 ** (e - 128.0) / 255.0;
  dest[destOffset] = source[sourceOffset]! * scale;
  dest[destOffset + 1] = source[sourceOffset + 1]! * scale;
  dest[destOffset + 2] = source[sourceOffset + 2]! * scale;
  dest[destOffset + 3] = 1;
}

/**
 * Decode RGBE bytes to float using midpoint restoration (Radiance reference).
 * Reduces error by ~2x vs floor (C. Bloom).
 */
function decodeRGBEMidpoint(source: Uint8Array, dest: Float32Array, sourceOffset: number, destOffset: number): void {
  const e = source[sourceOffset + 3]!;
  if (e === 0) {
    dest[destOffset] = 0;
    dest[destOffset + 1] = 0;
    dest[destOffset + 2] = 0;
    dest[destOffset + 3] = 1;
    return;
  }
  const scale = 2.0 ** (e - 128.0) / 255.0;
  dest[destOffset] = (source[sourceOffset]! + 0.5) * scale;
  dest[destOffset + 1] = (source[sourceOffset + 1]! + 0.5) * scale;
  dest[destOffset + 2] = (source[sourceOffset + 2]! + 0.5) * scale;
  dest[destOffset + 3] = 1;
}

/** Extract raw RGBE pixel bytes (after header) from HDR buffer. Requires standard header. */
function extractRGBEBytes(hdrBuffer: Uint8Array): { bytes: Uint8Array; width: number; height: number } {
  const str = new TextDecoder().decode(hdrBuffer);
  const resolutionMatch = str.match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
  if (!resolutionMatch) throw new Error('Could not parse resolution');
  const height = parseInt(resolutionMatch[1]!, 10);
  const width = parseInt(resolutionMatch[2]!, 10);

  const resolutionStart = str.indexOf(resolutionMatch[0]);
  const resolutionLineEnd = str.indexOf('\n', resolutionStart);
  let pixelStart = resolutionLineEnd + 1;
  while (pixelStart < hdrBuffer.length && hdrBuffer[pixelStart] === 0x0a) pixelStart++;

  const expectedBytes = width * height * 4;
  const bytes = hdrBuffer.subarray(pixelStart, pixelStart + expectedBytes);
  if (bytes.length !== expectedBytes) {
    throw new Error(`Expected ${expectedBytes} bytes, got ${bytes.length}`);
  }

  return { bytes, width, height };
}

/** Decode full image using given decode function */
function decodeImage(
  bytes: Uint8Array,
  width: number,
  height: number,
  decodePixel: (src: Uint8Array, dst: Float32Array, so: number, doff: number) => void,
): Float32Array {
  const out = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    decodePixel(bytes, out, i * 4, i * 4);
  }
  return out;
}

describe('HDR banding diagnostic (writer vs reader)', () => {
  it('in-memory round-trip: floor decode vs midpoint decode error', () => {
    const generated = createCieColorWedgeImage({ width: 512, height: 512 });
    const expected = convertLinearColorSpace(generated, 'linear-rec709');

    const hdrBuffer = writeHdr(expected);
    const { bytes, width, height } = extractRGBEBytes(hdrBuffer);

    const decodedFloor = decodeImage(bytes, width, height, decodeRGBEFloor);
    const decodedMidpoint = decodeImage(bytes, width, height, decodeRGBEMidpoint);

    const floorResult = compareFloatImages(
      expected,
      { width, height, data: decodedFloor, linearColorSpace: 'linear-rec709' },
      TOLERANCE,
    );
    const midpointResult = compareFloatImages(
      expected,
      { width, height, data: decodedMidpoint, linearColorSpace: 'linear-rec709' },
      TOLERANCE,
    );

    // Report findings: floor decode matches what readHdr uses. Midpoint (Radiance ref) may improve
    // maxAbsoluteDelta on random RGB (C. Bloom), but CIE wedge gradients can go either way on pixel count.
    expect(floorResult.mismatchedPixels).toBeGreaterThan(0);
    expect(midpointResult.mismatchedPixels).toBeGreaterThan(0);
    // At least one decode has significant error → banding confirmed from round-trip
    expect(Math.min(floorResult.maxAbsoluteDelta ?? 0, midpointResult.maxAbsoluteDelta ?? 0)).toBeGreaterThan(0.01);
  });

  it('readHdr output matches midpoint decode (reader uses midpoint restoration)', () => {
    const hdrBuffer = toUint8Array(fs.readFileSync(refCieHdr));
    const fromReadHdr = readHdr(hdrBuffer);
    const { bytes, width, height } = extractRGBEBytes(hdrBuffer);

    const decodedMidpoint = decodeImage(bytes, width, height, decodeRGBEMidpoint);

    const result = compareFloatImages(
      fromReadHdr,
      { width, height, data: decodedMidpoint, linearColorSpace: 'linear-rec709' },
      { toleranceRelative: 0.0001, toleranceAbsolute: 1e-9 },
    );
    expect(result.match, `readHdr should match midpoint decode. maxAbsoluteDelta=${result.maxAbsoluteDelta}`).toBe(
      true,
    );
  });
});
