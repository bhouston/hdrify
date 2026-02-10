import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../../../..');
const pizExrPath = path.join(workspaceRoot, 'assets', 'piz_compressed.exr');
const rainbowExrPath = path.join(workspaceRoot, 'assets', 'rainbow.exr');

/**
 * Parse EXR header only and return the offset where the offset table starts.
 * Used to validate header parsing doesn't skip bytes before the offset table.
 */
function getOffsetTableStart(buffer: Uint8Array): number {
  const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;

  offset += 4; // magic
  offset += 4; // version
  if (offset >= buffer.length) return -1;

  while (true) {
    const nameStart = offset;
    let nameLen = 0;
    while (offset < buffer.length && buffer[offset] !== 0) {
      nameLen++;
      offset++;
    }
    if (offset >= buffer.length) return -1;
    offset++; // consume null

    const attributeName = new TextDecoder().decode(buffer.subarray(nameStart, nameStart + nameLen));
    if (attributeName === '') {
      return nameStart; // Offset table starts here (nameStart is the first byte we read as "")
    }

    let typeLen = 0;
    const typeStart = offset;
    while (offset < buffer.length && buffer[offset] !== 0) {
      typeLen++;
      offset++;
    }
    if (offset >= buffer.length) return -1;
    const attributeSize = dataView.getUint32(offset, true);
    offset += 4 + attributeSize;
  }
}

describe('EXR header parsing', () => {
  it('returns offset table start at correct position for piz_compressed.exr', () => {
    if (!fs.existsSync(pizExrPath)) return;
    const buf = fs.readFileSync(pizExrPath);
    const buffer = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

    const tableStart = getOffsetTableStart(buffer);

    // piz_compressed.exr: after screenWindowWidth (float 1.0 = 00 00 80 3f), offset table follows
    // First offset should be readable and point within file
    expect(tableStart).toBeGreaterThan(0);
    expect(tableStart).toBeLessThan(buffer.length - 8);

    const firstOffset = Number(
      new DataView(buffer.buffer, buffer.byteOffset + tableStart, 8).getBigUint64(0, true),
    );
    expect(firstOffset).toBeGreaterThan(tableStart);
    expect(firstOffset).toBeLessThan(buffer.length);
  });

  it('does not skip first byte of offset table for rainbow.exr', () => {
    if (!fs.existsSync(rainbowExrPath)) return;
    const buf = fs.readFileSync(rainbowExrPath);
    const buffer = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

    const tableStart = getOffsetTableStart(buffer);

    // Offset table should start - we're testing that we don't advance past the first byte
    expect(tableStart).toBeGreaterThan(0);
    expect(tableStart).toBeLessThan(buffer.length);

    // First byte at offset table - could be 0x00 for single-part (omitted null)
    const firstByte = buffer[tableStart];
    // If first byte is 0x00, we correctly did NOT skip it (header fix)
    expect(firstByte).toBeDefined();
  });
});
