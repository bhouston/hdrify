import * as fs from 'node:fs';
import * as path from 'node:path';
import { readExr, readHdr } from 'hdrify';
import sharp from 'sharp';

function toUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

const EXR_COMPRESSION_NAMES: Record<number, string> = {
  0: 'NO_COMPRESSION',
  1: 'RLE',
  2: 'ZIPS',
  3: 'ZIP',
  4: 'PIZ',
  5: 'PXR24',
  6: 'B44',
  7: 'B44A',
};

export interface Metadata {
  width: number;
  height: number;
  compression?: string;
}

export async function validateExrOutput(filePath: string): Promise<Metadata> {
  const buf = fs.readFileSync(filePath);
  const data = readExr(toUint8Array(buf));
  const result: Metadata = { width: data.width, height: data.height };
  const compression = data.metadata?.compression as number | undefined;
  if (compression !== undefined) {
    result.compression = EXR_COMPRESSION_NAMES[compression] ?? `UNKNOWN (${compression})`;
  }
  return result;
}

export async function validateHdrOutput(filePath: string): Promise<Metadata> {
  const buf = fs.readFileSync(filePath);
  const data = readHdr(toUint8Array(buf));
  return { width: data.width, height: data.height };
}

export async function validateWithSharp(filePath: string): Promise<Metadata> {
  const meta = await sharp(filePath).metadata();
  if (meta.width == null || meta.height == null) {
    throw new Error(`Sharp could not read metadata from ${filePath}`);
  }
  return { width: meta.width, height: meta.height };
}

export function validateOutput(filePath: string): Promise<Metadata> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.exr') return validateExrOutput(filePath);
  if (ext === '.hdr') return validateHdrOutput(filePath);
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return validateWithSharp(filePath);
  throw new Error(`Unsupported format for validation: ${ext}`);
}
