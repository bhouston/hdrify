#!/usr/bin/env node
/**
 * Dump EXR header metadata (channels, lineOrder, dataWindow, etc.)
 * Usage: node scripts/dump-exr-metadata.mjs [path_to.exr]
 */
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(workspaceRoot, 'assets');

const defaultPath = path.join(assetsDir, 'example_pxr24.exr');
const exrPath = process.argv[2] ?? defaultPath;

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

const PIXEL_TYPE_NAMES = { 0: 'UINT', 1: 'HALF', 2: 'FLOAT' };
const LINE_ORDER_NAMES = { 0: 'INCREASING_Y', 1: 'DECREASING_Y' };

function parseExrMetadata(buffer) {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 8; // skip magic + version
  const result = { attributes: {} };

  while (offset < buffer.length) {
    const attrName = readNullTerminatedString(buffer, offset);
    offset += attrName.length + 1;
    if (attrName === '') break;

    const attrType = readNullTerminatedString(buffer, offset);
    offset += attrType.length + 1;
    const attrSize = dv.getUint32(offset, true);
    offset += 4;

    if (attrName === 'compression' && attrType === 'compression') {
      const v = dv.getUint8(offset);
      result.compression = v;
      result.attributes[attrName] = `compression ${v}`;
    } else if (attrName === 'dataWindow' && attrType === 'box2i') {
      const xMin = dv.getInt32(offset, true);
      const yMin = dv.getInt32(offset + 4, true);
      const xMax = dv.getInt32(offset + 8, true);
      const yMax = dv.getInt32(offset + 12, true);
      result.dataWindow = { xMin, yMin, xMax, yMax };
      result.attributes[attrName] = `(${xMin},${yMin})-(${xMax},${yMax})`;
      result.width = xMax - xMin + 1;
      result.height = yMax - yMin + 1;
    } else if (attrName === 'displayWindow' && attrType === 'box2i') {
      const xMin = dv.getInt32(offset, true);
      const yMin = dv.getInt32(offset + 4, true);
      const xMax = dv.getInt32(offset + 8, true);
      const yMax = dv.getInt32(offset + 12, true);
      result.displayWindow = { xMin, yMin, xMax, yMax };
      result.attributes[attrName] = `(${xMin},${yMin})-(${xMax},${yMax})`;
    } else if (attrName === 'lineOrder' && attrType === 'lineOrder') {
      const v = dv.getUint8(offset);
      result.lineOrder = v;
      result.attributes[attrName] = LINE_ORDER_NAMES[v] ?? `unknown(${v})`;
    } else if (attrName === 'channels' && attrType === 'chlist') {
      const channels = [];
      let chOffset = offset;
      while (chOffset < offset + attrSize) {
        const name = readNullTerminatedString(buffer, chOffset);
        chOffset += name.length + 1;
        if (name === '') break;
        const pixelType = dv.getInt32(chOffset, true);
        chOffset += 4 + 1 + 2 + 4 + 4; // pLinear, reserved, xSampling, ySampling
        channels.push({ name, pixelType: PIXEL_TYPE_NAMES[pixelType] ?? pixelType });
      }
      result.channels = channels;
      result.attributes[attrName] = channels.map((c) => `${c.name}:${c.pixelType}`).join(', ');
    }
    offset += attrSize;
  }
  result.offsetTableStart = offset;
  return result;
}

function main() {
  if (!fs.existsSync(exrPath)) {
    console.error(`File not found: ${exrPath}`);
    process.exit(1);
  }
  const buf = fs.readFileSync(exrPath);
  const meta = parseExrMetadata(new Uint8Array(buf));
  console.log(`\n=== ${path.basename(exrPath)} ===\n`);
  console.log('Dimensions:', meta.width, 'x', meta.height);
  console.log('Data window:', meta.dataWindow);
  console.log('Display window:', meta.displayWindow);
  console.log('Line order:', meta.attributes.lineOrder ?? 'not present');
  console.log('Compression:', meta.attributes.compression ?? meta.compression);
  console.log('Channels:', meta.channels?.map((c) => `${c.name}(${c.pixelType})`).join(' ') ?? 'none');
  console.log('Offset table starts at:', meta.offsetTableStart);
}

main();
