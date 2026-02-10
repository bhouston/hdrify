/**
 * EXR header builder tests
 * Round-trip: buildExrHeader output parses via parseExrHeader
 */

import { describe, expect, it } from 'vitest';
import { parseExrHeader } from './exrHeader.js';
import {
  buildExrHeader,
  buildExrHeaderForParsing,
  buildMagicAndVersion,
} from './exrHeaderBuilder.js';
import {
  EXR_MAGIC,
  FLOAT,
  NO_COMPRESSION,
  PIZ_COMPRESSION,
  RLE_COMPRESSION,
  ZIPS_COMPRESSION,
  ZIP_COMPRESSION,
} from './exrConstants.js';
import { concatUint8Arrays } from './exrUtils.js';

describe('buildMagicAndVersion', () => {
  it('returns 8 bytes with default magic and version', () => {
    const result = buildMagicAndVersion();
    expect(result.length).toBe(8);
    expect(new DataView(result.buffer).getUint32(0, true)).toBe(EXR_MAGIC);
    expect(new DataView(result.buffer).getUint32(4, true)).toBe(2);
  });

  it('accepts custom magic and version', () => {
    const result = buildMagicAndVersion({ magic: 0x12345678, version: 1 });
    expect(new DataView(result.buffer).getUint32(0, true)).toBe(0x12345678);
    expect(new DataView(result.buffer).getUint32(4, true)).toBe(1);
  });
});

describe('buildExrHeader round-trip', () => {
  it('parses via parseExrHeader with default options', () => {
    const full = concatUint8Arrays([buildMagicAndVersion(), buildExrHeader()]);
    const { header } = parseExrHeader(full);
    expect(header.displayWindow).toEqual({ xMin: 0, yMin: 0, xMax: 9, yMax: 9 });
    expect(header.dataWindow).toEqual({ xMin: 0, yMin: 0, xMax: 9, yMax: 9 });
    expect(header.compression).toBe(NO_COMPRESSION);
    expect(header.channels).toHaveLength(4);
  });

  it('parses via parseExrHeader with custom dimensions', () => {
    const full = concatUint8Arrays([
      buildMagicAndVersion(),
      buildExrHeader({ width: 100, height: 50 }),
    ]);
    const { header } = parseExrHeader(full);
    expect(header.displayWindow).toEqual({ xMin: 0, yMin: 0, xMax: 99, yMax: 49 });
    expect(header.dataWindow).toEqual({ xMin: 0, yMin: 0, xMax: 99, yMax: 49 });
  });

  it('parses via parseExrHeader with custom compression', () => {
    const full = concatUint8Arrays([
      buildMagicAndVersion(),
      buildExrHeader({ compression: PIZ_COMPRESSION }),
    ]);
    const { header } = parseExrHeader(full);
    expect(header.compression).toBe(PIZ_COMPRESSION);
  });

  it('parses via parseExrHeader with custom channels', () => {
    const full = concatUint8Arrays([
      buildMagicAndVersion(),
      buildExrHeader({
        channels: [
          { name: 'R', pixelType: FLOAT },
          { name: 'G', pixelType: 1 },
          { name: 'B', pixelType: 0 },
        ],
      }),
    ]);
    const { header } = parseExrHeader(full);
    expect(header.channels).toHaveLength(3);
    expect(header.channels[0]).toMatchObject({ name: 'R', pixelType: FLOAT });
    expect(header.channels[1]).toMatchObject({ name: 'G', pixelType: 1 });
    expect(header.channels[2]).toMatchObject({ name: 'B', pixelType: 0 });
  });
});

describe('buildExrHeaderForParsing', () => {
  it('produces buffer that parseExrHeader accepts', () => {
    const buffer = buildExrHeaderForParsing({ width: 20, height: 10 });
    const { header } = parseExrHeader(buffer);
    expect(header.displayWindow.xMax).toBe(19);
    expect(header.displayWindow.yMax).toBe(9);
  });

  it('accepts magic and version overrides for negative tests', () => {
    const buffer = buildExrHeaderForParsing({
      magic: 0x12345678,
      version: 2,
    });
    expect(() => parseExrHeader(buffer)).toThrow('incorrect magic number');
  });
});
