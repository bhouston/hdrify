import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  encodeGainMap,
  EXR_COMPRESSION_CODES,
  type ExrCompression,
  writeExr,
  writeHdr,
  writeJpegGainMap,
  writeJxl,
} from 'hdrify';
import * as vscode from 'vscode';
import { decodeHdrifyImage } from 'hdrify-react/decode';

const FORMAT_TO_EXTENSION: Record<string, string> = {
  exr: '.exr',
  hdr: '.hdr',
  jpeg: '.jpg',
  jxl: '.jxl',
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

export async function convertToFormat(
  uri: vscode.Uri,
  targetFormat: 'exr' | 'hdr' | 'jpeg' | 'jxl',
  options?: ConvertOptions,
): Promise<void> {
  const config = getConfig();
  const quality = Math.max(0, Math.min(100, config.get<number>('conversionQuality', 90) ?? 90));
  const leaveOriginal = config.get<boolean>('leaveOriginalWhenChangingFormat', false);
  const exrCompressionStr = (config.get<string>('exrCompression', 'piz') ?? 'piz').toLowerCase();
  const exrCompression: ExrCompression =
    exrCompressionStr in EXR_COMPRESSION_CODES ? (exrCompressionStr as ExrCompression) : 'piz';

  const inputPath = uri.fsPath;
  const outputPath = getOutputPathForConvert(inputPath, targetFormat);

  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    const buffer = new Uint8Array(raw);
    const image = await decodeHdrifyImage(buffer);

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
    } else if (targetFormat === 'jxl') {
      const bitDepth = config.get<string>('jxlBitDepth', 'float16');
      if (bitDepth !== 'float16' && bitDepth !== 'float32')
        throw new Error('JPEG XL bit depth must be float16 or float32');
      const bytes = writeJxl(image, { bitDepth });
      await vscode.workspace.fs.writeFile(vscode.Uri.file(outputPath), bytes);
    } else {
      throw new Error(`Unsupported target format: ${String(targetFormat)}`);
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
