import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JxlBitReader } from './jxlBitReader.js';
import { extractCodestream } from './jxlContainer.js';
import { readFrameHeader, readToc } from './jxlFrameHeader.js';
import { readImageHeader } from './jxlImageHeader.js';
import { ASSETS, readPfm } from './jxlTestAssets.js';
import { readJxl } from './readJxl.js';

describe('non-XYB progressive LF frames', () => {
  for (const level of [1, 2]) {
    it(`decodes nested LF level ${level} before RGB reconstruction`, () => {
      const file = `modular-colour/nonxyb_lf${level}`;
      const bytes = new Uint8Array(fs.readFileSync(new URL(`${file}.jxl`, ASSETS)));
      const { codestream } = extractCodestream(bytes);
      const br = new JxlBitReader(codestream);
      const header = readImageHeader(br);
      expect(header.xybEncoded).toBe(false);
      const levels: number[] = [];
      let pos = br.byteOffset;
      for (;;) {
        const reader = new JxlBitReader(codestream, pos);
        const fh = readFrameHeader(reader, header);
        if (fh.frameType === 'lf') levels.push(fh.lfLevel);
        const toc = readToc(reader, fh);
        pos = reader.byteOffset + toc.sizes.reduce((a, b) => a + b, 0);
        if (fh.isLast) break;
      }
      expect(levels).toEqual(level === 1 ? [1] : [2, 1]);
      const image = readJxl(bytes);
      const ref = readPfm(`${file}.ref.pfm`);
      let error = 0;
      for (let i = 0; i < image.width * image.height; i++)
        for (let c = 0; c < 3; c++) error = Math.max(error, Math.abs(image.data[4 * i + c] - ref.samples[3 * i + c]));
      expect(error).toBeLessThan(1e-5);
    });
  }
});
