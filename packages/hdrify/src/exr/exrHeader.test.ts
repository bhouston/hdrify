/**
 * Low-level EXR header parsing tests
 * Adapted from OpenEXR reference tests (testMagic, general_attr, parse_header.c)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FloatImageData } from '../floatImage.js';
import { NO_COMPRESSION, PIZ_COMPRESSION, RLE_COMPRESSION, ZIP_COMPRESSION, ZIPS_COMPRESSION } from './exrConstants.js';
import { parseExrHeader } from './exrHeader.js';
import { buildExrHeaderForParsing } from './exrHeaderBuilder.js';
import { writeExr } from './writeExr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../../../');
const pizExrPath = path.join(workspaceRoot, 'assets', 'example_piz.exr');
const rainbowExrPath = path.join(workspaceRoot, 'assets', 'example_zip.exr');

describe('EXR header parsing - magic number', () => {
  it('accepts valid magic number (0x76, 0x2f, 0x31, 0x01)', () => {
    const buffer = buildExrHeaderForParsing();
    const { header } = parseExrHeader(buffer);
    expect(header.header).toBeDefined();
  });

  it('throws on invalid magic number', () => {
    const buffer = buildExrHeaderForParsing({ magic: 0x12345678 });
    expect(() => parseExrHeader(buffer)).toThrow('incorrect magic number');
  });

  it('throws on wrong magic bytes', () => {
    const buffer = buildExrHeaderForParsing();
    buffer[0] = 0xff; // corrupt first byte
    expect(() => parseExrHeader(buffer)).toThrow('incorrect magic number');
  });
});

describe('EXR header parsing - version flags', () => {
  it('accepts single-part scanline version (2)', () => {
    const buffer = buildExrHeaderForParsing({ version: 2 });
    const { header } = parseExrHeader(buffer);
    expect(header.displayWindow).toBeDefined();
  });

  it('throws on tiled version (bit 0x200)', () => {
    const buffer = buildExrHeaderForParsing({ version: 2 | 0x200 });
    expect(() => parseExrHeader(buffer)).toThrow('Multi-part, tiled, and deep data');
  });

  it('throws on deep data version (bit 0x800)', () => {
    const buffer = buildExrHeaderForParsing({ version: 2 | 0x800 });
    expect(() => parseExrHeader(buffer)).toThrow('Multi-part, tiled, and deep data');
  });

  it('throws on multipart version (bit 0x1000)', () => {
    const buffer = buildExrHeaderForParsing({ version: 2 | 0x1000 });
    expect(() => parseExrHeader(buffer)).toThrow('Multi-part, tiled, and deep data');
  });
});

describe('EXR header parsing - box2i (displayWindow, dataWindow)', () => {
  it('parses displayWindow and dataWindow correctly', () => {
    const buffer = buildExrHeaderForParsing({ width: 100, height: 50 });
    const { header } = parseExrHeader(buffer);
    expect(header.displayWindow).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 99,
      yMax: 49,
    });
    expect(header.dataWindow).toEqual({
      xMin: 0,
      yMin: 0,
      xMax: 99,
      yMax: 49,
    });
  });

  it('parses non-zero origin data window', () => {
    const img = {
      width: 5,
      height: 5,
      linearColorSpace: 'linear-rec709' as const,
      data: new Float32Array(5 * 5 * 4).fill(0.5),
    } satisfies FloatImageData;
    const exr = writeExr(img);
    const { header } = parseExrHeader(exr);
    expect(header.dataWindow.xMax - header.dataWindow.xMin + 1).toBe(5);
    expect(header.dataWindow.yMax - header.dataWindow.yMin + 1).toBe(5);
  });
});

describe('EXR header parsing - chlist', () => {
  it('parses channel names, pixelType, xSampling, ySampling', () => {
    const buffer = buildExrHeaderForParsing({
      channels: [
        { name: 'R', pixelType: 2 },
        { name: 'G', pixelType: 1 },
        { name: 'B', pixelType: 0 },
      ],
    });
    const { header } = parseExrHeader(buffer);
    expect(header.channels).toHaveLength(3);
    expect(header.channels[0]).toMatchObject({
      name: 'R',
      pixelType: 2,
      xSampling: 1,
      ySampling: 1,
    });
    expect(header.channels[1]).toMatchObject({
      name: 'G',
      pixelType: 1,
      xSampling: 1,
      ySampling: 1,
    });
    expect(header.channels[2]).toMatchObject({
      name: 'B',
      pixelType: 0,
      xSampling: 1,
      ySampling: 1,
    });
  });

  it('parses custom xSampling and ySampling', () => {
    const buffer = buildExrHeaderForParsing({
      channels: [{ name: 'Y', pixelType: 1, xSampling: 2, ySampling: 2 }],
    });
    const { header } = parseExrHeader(buffer);
    expect(header.channels[0]).toMatchObject({
      name: 'Y',
      xSampling: 2,
      ySampling: 2,
    });
  });
});

describe('EXR header parsing - compression', () => {
  it('accepts NO_COMPRESSION (0)', () => {
    const buffer = buildExrHeaderForParsing({ compression: NO_COMPRESSION });
    const { header } = parseExrHeader(buffer);
    expect(header.compression).toBe(0);
  });

  it('accepts RLE_COMPRESSION (1)', () => {
    const buffer = buildExrHeaderForParsing({ compression: RLE_COMPRESSION });
    const { header } = parseExrHeader(buffer);
    expect(header.compression).toBe(1);
  });

  it('accepts ZIPS_COMPRESSION (2)', () => {
    const buffer = buildExrHeaderForParsing({ compression: ZIPS_COMPRESSION });
    const { header } = parseExrHeader(buffer);
    expect(header.compression).toBe(2);
  });

  it('accepts ZIP_COMPRESSION (3)', () => {
    const buffer = buildExrHeaderForParsing({ compression: ZIP_COMPRESSION });
    const { header } = parseExrHeader(buffer);
    expect(header.compression).toBe(3);
  });

  it('accepts PIZ_COMPRESSION (4)', () => {
    const buffer = buildExrHeaderForParsing({ compression: PIZ_COMPRESSION });
    const { header } = parseExrHeader(buffer);
    expect(header.compression).toBe(4);
  });

  it('accepts PXR24 compression (5)', () => {
    const buffer = buildExrHeaderForParsing({ compression: 5 });
    const { header } = parseExrHeader(buffer);
    expect(header.compression).toBe(5);
  });

  it('throws on unsupported compression (6)', () => {
    const buffer = buildExrHeaderForParsing({ compression: 6 });
    expect(() => parseExrHeader(buffer)).toThrow('Unsupported EXR compression');
  });

  it('throws on unsupported compression (7)', () => {
    const buffer = buildExrHeaderForParsing({ compression: 7 });
    expect(() => parseExrHeader(buffer)).toThrow('Unsupported EXR compression');
  });
});

describe('EXR header parsing - required attributes', () => {
  it('throws when displayWindow is omitted', () => {
    const buffer = buildExrHeaderForParsing({ omitAttributes: ['displayWindow'] });
    expect(() => parseExrHeader(buffer)).toThrow('missing required header attributes');
  });

  it('throws when dataWindow is omitted', () => {
    const buffer = buildExrHeaderForParsing({ omitAttributes: ['dataWindow'] });
    expect(() => parseExrHeader(buffer)).toThrow('missing required header attributes');
  });

  it('throws when channels is omitted', () => {
    const buffer = buildExrHeaderForParsing({ omitAttributes: ['channels'] });
    expect(() => parseExrHeader(buffer)).toThrow('missing required header attributes');
  });
});

describe('EXR header parsing - string attribute', () => {
  it('parses optional string attribute correctly', () => {
    const buffer = buildExrHeaderForParsing({
      extraAttributes: [
        {
          name: 'comments',
          type: 'string',
          value: new TextEncoder().encode('test comment\0'),
        },
      ],
    });
    const { header } = parseExrHeader(buffer);
    expect(header.header.comments).toBe('test comment');
  });
});

describe('EXR header parsing - unknown attribute skip', () => {
  it('skips unknown attribute type and continues', () => {
    // Add a custom attribute with unknown type "customType" and size 4
    const buffer = buildExrHeaderForParsing({
      extraAttributes: [
        {
          name: 'customAttr',
          type: 'customType',
          value: new Uint8Array([0x12, 0x34, 0x56, 0x78]),
        },
      ],
    });
    const { header } = parseExrHeader(buffer);
    // Should still parse successfully - unknown attr is skipped
    expect(header.displayWindow).toBeDefined();
    expect(header.channels).toHaveLength(4);
  });
});

describe('EXR header parsing - offset position', () => {
  it('returns correct offset after header for example_piz.exr', () => {
    const buf = fs.readFileSync(pizExrPath);
    const buffer = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

    const { offset } = parseExrHeader(buffer);

    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(buffer.length);

    // Offset table follows header - first entry should be valid
    const firstOffset = Number(new DataView(buffer.buffer, buffer.byteOffset + offset, 8).getBigUint64(0, true));
    expect(firstOffset).toBeGreaterThan(offset);
    expect(firstOffset).toBeLessThan(buffer.length);
  });

  it('parses example_zip.exr and returns valid offset', () => {
    const buf = fs.readFileSync(rainbowExrPath);
    const buffer = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

    const { header, offset } = parseExrHeader(buffer);

    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(buffer.length);
    expect(header.displayWindow).toBeDefined();
    expect(header.dataWindow).toBeDefined();
    expect(header.channels.length).toBeGreaterThan(0);
  });
});
