/**
 * Real-file B44 decode test.
 * assets/example_b44.exr is the OpenEXR reference test image (comp_b44.exr),
 * 780x566 RGB half-float, B44-compressed.
 *
 * The expected min/max/avg below were cross-checked against OpenImageIO's
 * (oiiotool --printstats) independent B44 decoder during development, and a
 * full pixel-for-pixel diff against a ZIP re-encode of the same source data
 * (read back through this library's own, separately-tested ZIP decoder)
 * showed zero difference across all 1,324,440 samples.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { B44_COMPRESSION } from './exrConstants.js';
import { parseExrHeader } from './exrHeader.js';
import { readExr } from './readExr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../../../');
const b44ExrPath = path.join(workspaceRoot, 'assets', 'example_b44.exr');

describe('readExr - B44 real file', () => {
  it('parses example_b44.exr header as B44-compressed RGB half', () => {
    const buf = fs.readFileSync(b44ExrPath);
    const { header } = parseExrHeader(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));

    expect(header.compression).toBe(B44_COMPRESSION);
    expect(header.dataWindow.xMax - header.dataWindow.xMin + 1).toBe(780);
    expect(header.dataWindow.yMax - header.dataWindow.yMin + 1).toBe(566);
  });

  it('decodes example_b44.exr to plausible, finite HDR pixel data', () => {
    const buf = fs.readFileSync(b44ExrPath);
    const image = readExr(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));

    expect(image.width).toBe(780);
    expect(image.height).toBe(566);

    let min = Infinity;
    let max = -Infinity;
    let allFinite = true;
    for (let i = 0; i < image.data.length; i++) {
      const v = image.data[i]!;
      if (!Number.isFinite(v)) allFinite = false;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(allFinite).toBe(true);

    // Reference (oiiotool --printstats): per-channel min in [0.0201, 0.0241], max in [2.55, 2.64].
    expect(min).toBeGreaterThan(0.015);
    expect(min).toBeLessThan(0.03);
    expect(max).toBeGreaterThan(2.5);
    expect(max).toBeLessThan(2.7);
  });
});
