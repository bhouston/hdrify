import * as fs from 'node:fs';
import * as path from 'node:path';
import { encodeGainMap, readExr, readHdr, readJpegGainMap, writeExr, writeHdr, writeJpegGainMap } from 'hdrify';
import * as vscode from 'vscode';

// EXR compression constants (OpenEXR standard)
const NO_COMPRESSION = 0;
const RLE_COMPRESSION = 1;
const ZIPS_COMPRESSION = 2;
const ZIP_COMPRESSION = 3;
const PIZ_COMPRESSION = 4;
const PXR24_COMPRESSION = 5;

const FORMAT_TO_EXTENSION: Record<string, string> = {
  exr: '.exr',
  hdr: '.hdr',
  jpeg: '.jpg',
};

const EXR_COMPRESSION_MAP: Record<string, number> = {
  none: NO_COMPRESSION,
  rle: RLE_COMPRESSION,
  zips: ZIPS_COMPRESSION,
  zip: ZIP_COMPRESSION,
  piz: PIZ_COMPRESSION,
  pxr24: PXR24_COMPRESSION,
};

function getConfig() {
  return vscode.workspace.getConfiguration('hdrify');
}

function getOutputPathForConvert(inputPath: string, targetFormat: string): string {
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const baseWithoutExt = path.basename(inputPath, ext);
  const targetExt = FORMAT_TO_EXTENSION[targetFormat] ?? `.${targetFormat}`;
  return path.join(dir, `${baseWithoutExt}${targetExt}`);
}

export interface ConvertOptions {
  silent?: boolean;
}

function readImage(buffer: Uint8Array, ext: string) {
  const lower = ext.toLowerCase();
  if (lower === '.exr') {
    return readExr(buffer);
  }
  if (lower === '.hdr') {
    return readHdr(buffer);
  }
  if (lower === '.jpg' || lower === '.jpeg') {
    return readJpegGainMap(buffer);
  }
  throw new Error(`Unsupported input format: ${ext}`);
}

export async function convertToFormat(
  uri: vscode.Uri,
  targetFormat: 'exr' | 'hdr' | 'jpeg',
  options?: ConvertOptions,
): Promise<void> {
  const config = getConfig();
  // biome-ignore lint/security/noSecrets: VS Code config key, not a secret
  const quality = Math.max(0, Math.min(100, config.get<number>('conversionQuality', 90) ?? 90));
  // biome-ignore lint/security/noSecrets: VS Code config key, not a secret
  const leaveOriginal = config.get<boolean>('leaveOriginalWhenChangingFormat', false);
  // biome-ignore lint/security/noSecrets: VS Code config key, not a secret
  const exrCompressionStr = config.get<string>('exrCompression', 'piz') ?? 'piz';
  const exrCompression = EXR_COMPRESSION_MAP[exrCompressionStr.toLowerCase()] ?? PIZ_COMPRESSION;

  const inputPath = uri.fsPath;
  const outputPath = getOutputPathForConvert(inputPath, targetFormat);

  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    const buffer = new Uint8Array(raw);
    const ext = path.extname(inputPath);
    const image = readImage(buffer, ext);

    if (targetFormat === 'exr') {
      const bytes = writeExr(image, { compression: exrCompression });
      await vscode.workspace.fs.writeFile(vscode.Uri.file(outputPath), bytes);
    } else if (targetFormat === 'hdr') {
      const bytes = writeHdr(image);
      await vscode.workspace.fs.writeFile(vscode.Uri.file(outputPath), bytes);
    } else if (targetFormat === 'jpeg') {
      const encoding = encodeGainMap(image, { toneMapping: 'neutral' });
      const bytes = writeJpegGainMap(encoding, { quality });
      await vscode.workspace.fs.writeFile(vscode.Uri.file(outputPath), bytes);
    } else {
      throw new Error(`Unsupported target format: ${targetFormat}`);
    }

    if (!leaveOriginal && inputPath !== outputPath) {
      await fs.promises.unlink(inputPath);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`HDRify: ${message}`);
    throw err;
  }

  if (!options?.silent) {
    vscode.window.showInformationMessage(
      `Converted to ${targetFormat === 'jpeg' ? 'UltraHDR Jpeg' : targetFormat.toUpperCase()}: ${path.basename(outputPath)}`,
    );
  }
}
