import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHdr, writeHdr } from 'hdrify';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../../..');
const assetsDir = path.join(workspaceRoot, 'assets');

function toUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const hdrFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.hdr'));

describe('hdrWriter round-trip', () => {
  it('should round-trip actual HDR file', () => {
    expect(hdrFiles.length, 'assets dir must contain .hdr files').toBeGreaterThan(0);
    // biome-ignore lint/style/noNonNullAssertion: file exists
    const file = hdrFiles[0]!;
    const filepath = path.join(assetsDir, file);
    const hdrBuffer = toUint8Array(fs.readFileSync(filepath));

    const originalData = readHdr(hdrBuffer);
    const writtenBuffer = writeHdr(originalData);
    const parsedData = readHdr(writtenBuffer);

    expect(parsedData.width).toBe(originalData.width);
    expect(parsedData.height).toBe(originalData.height);
    expect(parsedData.data.length).toBeGreaterThan(0);
    expect(parsedData.data.length).toBeGreaterThanOrEqual(originalData.width * originalData.height * 3);
  });
});
