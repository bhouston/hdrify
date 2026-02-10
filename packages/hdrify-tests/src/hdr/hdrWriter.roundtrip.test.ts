import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHDRFile, writeHDRFile } from 'hdrify';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../../..');
const assetsDir = path.join(workspaceRoot, 'assets');

function toUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const hdrFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter((f) => f.endsWith('.hdr')) : [];

describe('hdrWriter round-trip', () => {
  it('should round-trip actual HDR file', () => {
    if (hdrFiles.length === 0) return;

    const file = hdrFiles[0];
    if (!file) return;
    const filepath = path.join(assetsDir, file);
    const hdrBuffer = toUint8Array(fs.readFileSync(filepath));

    const originalData = parseHDRFile(hdrBuffer);
    const writtenBuffer = writeHDRFile(originalData);
    const parsedData = parseHDRFile(writtenBuffer);

    expect(parsedData.width).toBe(originalData.width);
    expect(parsedData.height).toBe(originalData.height);
    expect(parsedData.data.length).toBeGreaterThan(0);
    expect(parsedData.data.length).toBeGreaterThanOrEqual(originalData.width * originalData.height * 3);
  });
});
