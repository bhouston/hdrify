#!/usr/bin/env node
/**
 * Check compression type of EXR files.
 * Usage: node scripts/check-exr-compression.mjs <file.exr> [file2.exr ...]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const COMPRESSION_NAMES = {
  0: 'none',
  1: 'RLE',
  2: 'ZIPS',
  3: 'ZIP',
  4: 'PIZ',
  5: 'PXR24',
  6: 'B44',
  7: 'B44A',
};

function readNullTerminatedString(buffer, offset) {
  const bytes = [];
  let pos = offset;
  while (pos < buffer.length) {
    const byte = buffer[pos];
    if (byte === 0) break;
    bytes.push(byte);
    pos++;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function getCompression(buffer) {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 8; // skip magic + version

  while (offset < buffer.length) {
    const attrName = readNullTerminatedString(buffer, offset);
    offset += attrName.length + 1;
    if (attrName === '') break;

    const attrType = readNullTerminatedString(buffer, offset);
    offset += attrType.length + 1;
    const attrSize = dv.getUint32(offset, true);
    offset += 4;

    if (attrName === 'compression' && attrType === 'compression') {
      return dv.getUint8(offset);
    }
    offset += attrSize;
  }
  return null;
}

const files = process.argv.slice(2).filter((f) => f.endsWith('.exr'));
if (files.length === 0) {
  console.error('Usage: node scripts/check-exr-compression.mjs <file.exr> [file2.exr ...]');
  process.exit(1);
}

for (const file of files) {
  try {
    const buf = fs.readFileSync(file);
    const comp = getCompression(new Uint8Array(buf));
    const name = COMPRESSION_NAMES[comp] ?? `unknown (${comp})`;
    console.log(`${path.basename(file)}: ${name}`);
  } catch (e) {
    console.error(`${file}: ${e.message}`);
  }
}
