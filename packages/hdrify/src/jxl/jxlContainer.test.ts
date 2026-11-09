import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractCodestream, isJxl, readJxlBoxMetadata } from './jxlContainer.js';
import { readJxl, readJxlFrames } from './readJxl.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../assets/jxl');
const load = (name: string) => new Uint8Array(fs.readFileSync(path.join(ASSETS, name)));

const SIG = [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const be32 = (v: number) => [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const box = (type: string, body: number[]) => [...be32(body.length + 8), ...ascii(type), ...body];
const ftyp = box('ftyp', [...ascii('jxl '), 0, 0, 0, 0, ...ascii('jxl ')]);
const exifBox = (offset: number) => ({ type: 'Exif', data: new Uint8Array([...be32(offset), 9, 9, 0x4d, 0x4d]) });
const file = (...parts: number[][]) => new Uint8Array([...SIG, ...ftyp, ...parts.flat()]);

describe('extractCodestream', () => {
  it('passes a bare codestream through', () => {
    const data = load('lossless_rgb8.jxl');
    const r = extractCodestream(data);
    expect(r.isContainer).toBe(false);
    expect(r.codestream).toBe(data);
    expect(r.boxes).toEqual([]);
  });

  it('extracts a jxlc box (same codestream as the bare encode)', () => {
    const r = extractCodestream(load('lossless_rgb8_container.jxl'));
    expect(r.isContainer).toBe(true);
    expect(r.codestream).toEqual(load('lossless_rgb8.jxl'));
    expect(r.boxes).toEqual([]);
  });

  it('keeps jxll as an auxiliary box', () => {
    const r = extractCodestream(load('lossless_rgb16.jxl'));
    expect(r.codestream.length).toBe(17659);
    expect(r.boxes.map((b) => [b.type, b.data.length])).toEqual([['jxll', 1]]);
  });

  it('concatenates jxlp parts around a brob Exif box', () => {
    const r = extractCodestream(load('lossless_rgba8.jxl'));
    expect(r.codestream.length).toBe(8 + 1350); // jxlp bodies minus their 4-byte indices
    expect([r.codestream[0], r.codestream[1]]).toEqual([0xff, 0x0a]);
    expect(r.boxes.map((b) => b.type)).toEqual(['brob']); // Exif size varies: oiiotool stamps the source PNG
    expect(String.fromCharCode(...r.boxes[0].data.subarray(0, 4))).toBe('Exif');
  });

  it('orders jxlp parts and handles 64-bit and to-EOF box sizes', () => {
    const xl = [0, 0, 0, 1, ...ascii('jxlp'), 0, 0, 0, 0, 0, 0, 0, 16 + 4 + 2, 0, 0, 0, 1, 3, 4];
    const toEof = [0, 0, 0, 0, ...ascii('jxlp'), 0x80, 0, 0, 2, 5, 6];
    const r = extractCodestream(file(box('jxlp', [0, 0, 0, 0, 0xff, 0x0a]), box('Exif', [9]), xl, toEof));
    expect([...r.codestream]).toEqual([0xff, 0x0a, 3, 4, 5, 6]);
    expect(r.boxes).toEqual([{ type: 'Exif', data: new Uint8Array([9]) }]);
  });

  it('rejects malformed containers', () => {
    expect(() => extractCodestream(new Uint8Array([0xff, 0x0b]))).toThrow(/not a JPEG XL/);
    expect(() => extractCodestream(new Uint8Array(SIG.slice(0, 11)))).toThrow(/not a JPEG XL/);
    expect(() => extractCodestream(file())).toThrow(/no codestream/);
    expect(() => extractCodestream(file(box('jxlp', [0, 0, 0, 1, 0xff])))).toThrow(/out of order/);
    expect(() => extractCodestream(file(box('jxlc', [0xff, 0x0a]), box('jxlc', [1])))).toThrow(/multiple/);
    expect(() => extractCodestream(file(box('jxlc', [0xff]), box('jxlp', [0, 0, 0, 0])))).toThrow(/unexpected jxlp/);
    expect(() => extractCodestream(file([0, 0, 0, 99, ...ascii('jxlc')]))).toThrow(/invalid size/);
    expect(() => extractCodestream(file([0, 0, 0, 4, ...ascii('jxlc')]))).toThrow(/invalid size/);
    expect(() => extractCodestream(file([0, 0, 0]))).toThrow(/truncated/);
  });
});

describe('isJxl', () => {
  it('detects both signatures', () => {
    expect(isJxl(load('lossless_rgb8.jxl'))).toBe(true);
    expect(isJxl(load('lossless_float16.jxl'))).toBe(true);
    expect(isJxl(new Uint8Array([0xff, 0xd8]))).toBe(false);
    expect(isJxl(new Uint8Array([]))).toBe(false);
  });
});

describe('EXIF/XMP container boxes', () => {
  const exif = load('features/metadata_boxes.exif'); // exiftool -b -EXIF
  const xmp = new TextDecoder().decode(load('features/metadata_boxes.xmp')); // exiftool -b -XMP

  it('returns the same EXIF/XMP bytes as exiftool for plain and brob boxes', () => {
    for (const name of ['features/metadata_boxes.jxl', 'features/metadata_brob.jxl']) {
      const { metadata } = readJxl(load(name));
      expect(metadata!.exif).toEqual(exif);
      expect(metadata!.xmp).toBe(xmp);
      const [frame] = readJxlFrames(load(name)).frames;
      expect(frame.image.metadata!.exif).toEqual(exif);
      expect(frame.image.metadata!.xmp).toBe(xmp);
    }
    expect(extractCodestream(load('features/metadata_brob.jxl')).boxes.map((b) => b.type)).toEqual(['brob', 'brob']);
  });

  it('skips brob boxes without a Brotli decoder (browsers)', () => {
    const { boxes } = extractCodestream(load('features/metadata_brob.jxl'));
    expect(readJxlBoxMetadata(boxes, null)).toEqual({});
  });

  it('honours the Exif TIFF header offset and ignores out-of-range offsets', () => {
    expect(readJxlBoxMetadata([exifBox(2)]).exif).toEqual(new Uint8Array([0x4d, 0x4d]));
    expect(readJxlBoxMetadata([exifBox(5)])).toEqual({});
  });

  it('reports no EXIF/XMP for bare codestreams', () => {
    const { metadata } = readJxl(load('lossless_rgb8.jxl'));
    expect(metadata).not.toHaveProperty('exif');
    expect(metadata).not.toHaveProperty('xmp');
  });
});
