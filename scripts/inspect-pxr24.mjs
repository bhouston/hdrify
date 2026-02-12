#!/usr/bin/env node
/**
 * Inspect PXR24 compressed block structure.
 * Compares external (example_pxr24.exr) vs hdrify-generated PXR24.
 * Usage: pnpm build && node scripts/inspect-pxr24.mjs
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzlibSync } from 'fflate';
import { createHsvRainbowImage, writeExr } from '../packages/hdrify/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(workspaceRoot, 'assets');

const _ULONG_SIZE = 8;
const INT32_SIZE = 4;
const PXR24_COMPRESSION = 5;

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

function parseExrHeaderSimple(buffer) {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 8; // skip magic + version
  let dataWindow = null;
  const channels = [];
  let compression = null;

  while (offset < buffer.length) {
    const attrName = readNullTerminatedString(buffer, offset);
    offset += attrName.length + 1;
    if (attrName === '') break;

    const attrType = readNullTerminatedString(buffer, offset);
    offset += attrType.length + 1;
    const attrSize = dv.getUint32(offset, true);
    offset += 4;

    if (attrName === 'compression' && attrType === 'compression') {
      compression = dv.getUint8(offset);
    } else if (attrName === 'dataWindow' && attrType === 'box2i') {
      dataWindow = {
        xMin: dv.getInt32(offset, true),
        yMin: dv.getInt32(offset + 4, true),
        xMax: dv.getInt32(offset + 8, true),
        yMax: dv.getInt32(offset + 12, true),
      };
    } else if (attrName === 'channels' && attrType === 'chlist') {
      let chOffset = offset;
      while (chOffset < offset + attrSize) {
        const name = readNullTerminatedString(buffer, chOffset);
        chOffset += name.length + 1;
        if (name === '') break;
        const pixelType = dv.getInt32(chOffset, true);
        chOffset += 4 + 4; // pLinear, reserved(3), xSampling, ySampling
        channels.push({ name, pixelType });
      }
    }
    offset += attrSize;
  }
  return { offset, dataWindow, channels, compression };
}

function extractFirstPxr24Block(exrBuffer) {
  const dv = new DataView(exrBuffer.buffer, exrBuffer.byteOffset, exrBuffer.byteLength);
  const { offset, dataWindow, channels, compression } = parseExrHeaderSimple(exrBuffer);

  if (compression !== PXR24_COMPRESSION) {
    throw new Error(`Expected PXR24, got compression ${compression}`);
  }

  const width = dataWindow.xMax - dataWindow.xMin + 1;
  const height = dataWindow.yMax - dataWindow.yMin + 1;
  const blockHeight = 16;
  const numChannels = channels.length;

  // Read first block offset
  const firstOffset = Number(dv.getBigUint64(offset, true));
  if (firstOffset < 0 || firstOffset >= exrBuffer.length) {
    throw new Error(`Invalid first block offset: ${firstOffset}`);
  }

  let pos = firstOffset;
  const y = dv.getInt32(pos, true);
  pos += INT32_SIZE;
  const dataSize = dv.getUint32(pos, true);
  pos += INT32_SIZE;

  const compressedData = exrBuffer.subarray(pos, pos + dataSize);
  const raw = unzlibSync(compressedData);

  const linesInBlock = Math.min(blockHeight, height - y);
  const samplesPerChannel = width * linesInBlock;
  const totalSamples = samplesPerChannel * numChannels;
  const expectedBytes = totalSamples * 2; // HALF = 2 bytes per sample

  return {
    raw,
    width,
    linesInBlock,
    numChannels,
    totalSamples,
    expectedBytes,
  };
}

function analyzeStructure(raw, label) {
  const n = raw.length;
  const half = Math.floor(n / 2);

  // Sequential: [lo0,hi0, lo1,hi1, ...] - even indices=lo, odd=hi
  // Transposed: [lo0,lo1,..., lo_n, hi0,hi1,..., hi_n] - first half=lo, second half=hi

  const sequentialLo = [];
  const sequentialHi = [];
  for (let i = 0; i < n - 1; i += 2) {
    sequentialLo.push(raw[i]);
    sequentialHi.push(raw[i + 1]);
  }

  const _transposedLo = raw.subarray(0, half);
  const _transposedHi = raw.subarray(half, half * 2);

  // Sample statistics
  const first16 = Array.from(raw.subarray(0, Math.min(32, n)));
  const last16 = Array.from(raw.subarray(Math.max(0, n - 32), n));

  console.log(`\n=== ${label} ===`);
  console.log(`Raw length: ${n}`);
  console.log(`First 32 bytes (hex): ${Buffer.from(raw.subarray(0, 32)).toString('hex')}`);
  console.log(`First 32 bytes: [${first16.join(', ')}]`);
  if (n > 64) {
    console.log(
      `Bytes at mid-32 (transposed would be start of hi): ${Array.from(raw.subarray(half, half + 32)).join(', ')}`,
    );
  }
  console.log(`Last 32 bytes: [${last16.join(', ')}]`);

  // If transposed: first half = all low bytes, second half = all high bytes
  // For delta-encoded half floats, high bytes often have more structure (exponent)
  const firstHalfMean = raw.subarray(0, half).reduce((a, b) => a + b, 0) / half;
  const secondHalfMean = raw.subarray(half, n).reduce((a, b) => a + b, 0) / (n - half);
  console.log(`First half mean: ${firstHalfMean.toFixed(2)}, second half mean: ${secondHalfMean.toFixed(2)}`);
}

async function main() {
  // Build hdrify first
  const { execSync } = await import('node:child_process');
  execSync('pnpm build', { cwd: workspaceRoot, stdio: 'pipe' });

  const externalPath = path.join(assetsDir, 'example_pxr24.exr');
  if (!fs.existsSync(externalPath)) {
    console.error('example_pxr24.exr not found');
    process.exit(1);
  }

  const externalBuf = new Uint8Array(fs.readFileSync(externalPath));
  const external = extractFirstPxr24Block(externalBuf);
  console.log('External example_pxr24.exr first block:');
  console.log(`  width=${external.width}, lines=${external.linesInBlock}, channels=${external.numChannels}`);
  console.log(
    `  totalSamples=${external.totalSamples}, expectedBytes=${external.expectedBytes}, raw.length=${external.raw.length}`,
  );

  // Create hdrify PXR24 with same dimensions for first block (16 lines)
  const hdrifyImage = createHsvRainbowImage({ width: external.width, height: 16, value: 1, intensity: 1 });
  const hdrifyBuf = writeExr(hdrifyImage, { compression: PXR24_COMPRESSION });
  const hdrify = extractFirstPxr24Block(new Uint8Array(hdrifyBuf));
  console.log('\nHdrify-generated PXR24 first block:');
  console.log(`  width=${hdrify.width}, lines=${hdrify.linesInBlock}, channels=${hdrify.numChannels}`);
  console.log(
    `  totalSamples=${hdrify.totalSamples}, expectedBytes=${hdrify.expectedBytes}, raw.length=${hdrify.raw.length}`,
  );

  analyzeStructure(external.raw, 'External (example_pxr24.exr)');
  analyzeStructure(hdrify.raw, 'Hdrify-generated');

  // Compare structure: is external transposed?
  // Transposed format: raw[i] and raw[i + totalSamples] form the i-th sample
  // Sequential: raw[2*i] and raw[2*i+1] form the i-th sample
  const n = external.raw.length;
  const samples = Math.floor(n / 2);
  if (samples === external.totalSamples) {
    console.log('\n--- Transposition check ---');
    const asSequential = (buf) => {
      const out = new Uint8Array(buf.length);
      for (let i = 0; i < samples; i++) {
        out[i * 2] = buf[i];
        out[i * 2 + 1] = buf[samples + i];
      }
      return out;
    };
    const _externalAsSequential = asSequential(external.raw);
    const matchHdrify = external.raw.length === hdrify.raw.length && external.raw.every((b, i) => b === hdrify.raw[i]);
    console.log(`External raw === Hdrify raw (byte-for-byte): ${matchHdrify}`);

    // Try interpreting external as transposed
    const externalUntransposed = asSequential(external.raw);
    const matchHdrifyAfterUntranspose =
      externalUntransposed.length === hdrify.raw.length && externalUntransposed.every((b, i) => b === hdrify.raw[i]);
    console.log(`External (undo transposition) === Hdrify raw: ${matchHdrifyAfterUntranspose}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
