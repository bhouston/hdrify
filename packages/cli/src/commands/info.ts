import * as fs from 'node:fs';
import * as path from 'node:path';
import { addRangeMetadata, type HdrifyImage, readExr, readHdr, readJpegGainMap } from 'hdrify';
import { defineCommand } from 'yargs-file-commands';

function yamlStringNeedsEscape(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 31 || c === 127 || c === 10 || c === 13 || c === 34 || c === 39) return true;
  }
  return false;
}

const COMPRESSION_NAMES: Record<number, string> = {
  0: 'NO_COMPRESSION',
  1: 'RLE',
  2: 'ZIPS',
  3: 'ZIP',
  4: 'PIZ',
  5: 'PXR24',
  6: 'B44',
  7: 'B44A',
};

interface InfoOutput {
  format: string;
  width: number;
  height: number;
  compression?: string;
  metadata?: Record<string, unknown>;
}

function stringifyYamlValue(value: unknown, indent: number): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'string') {
    if (yamlStringNeedsEscape(value) || value.includes('#')) {
      return JSON.stringify(value);
    }
    return value.includes(':') || value.includes(' ') ? `"${value}"` : value;
  }
  if (Array.isArray(value)) {
    const itemPad = '  '.repeat(indent);
    const parts: string[] = [];
    for (const item of value) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const objStr = stringifyYaml(item as Record<string, unknown>, indent + 1);
        const objLines = objStr.split('\n').map((line) => `  ${line}`);
        parts.push(`${itemPad}-`);
        parts.push(objLines.join('\n'));
      } else {
        parts.push(`${itemPad}- ${stringifyYamlValue(item, 0)}`);
      }
    }
    return parts.join('\n');
  }
  if (typeof value === 'object') {
    return stringifyYaml(value as Record<string, unknown>, indent);
  }
  return String(value);
}

function stringifyYaml(obj: Record<string, unknown>, indent: number): string {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const sub = stringifyYaml(v as Record<string, unknown>, indent + 1);
      if (sub) {
        lines.push(`${pad}${k}:`);
        lines.push(sub);
      } else {
        lines.push(`${pad}${k}: {}`);
      }
    } else if (Array.isArray(v)) {
      lines.push(`${pad}${k}:`);
      lines.push(stringifyYamlValue(v, indent + 1));
    } else {
      lines.push(`${pad}${k}: ${stringifyYamlValue(v, 0)}`);
    }
  }
  return lines.join('\n');
}

function buildInfoOutput(imageData: HdrifyImage, ext: string): InfoOutput {
  const format = ext.toUpperCase().slice(1);
  const output: InfoOutput = {
    format,
    width: imageData.width,
    height: imageData.height,
  };

  if (ext === '.exr' && imageData.metadata) {
    const compression = imageData.metadata.compression as number | undefined;
    if (compression !== undefined) {
      output.compression = COMPRESSION_NAMES[compression] ?? `UNKNOWN (${compression})`;
    }
  }

  const rangeMeta = addRangeMetadata(imageData);
  output.metadata = { ...(imageData.metadata ?? {}), ...rangeMeta };

  return output;
}

export const command = defineCommand({
  command: 'info <file>',
  describe: 'Display metadata about EXR, HDR, or JPEG gain map files',
  builder: (yargs) =>
    yargs
      .positional('file', {
        describe: 'Input file path (.exr, .hdr, or .jpg/.jpeg with gain map)',
        type: 'string',
        demandOption: true,
      })
      .option('format', {
        describe: 'Output format: yaml (default) or json',
        type: 'string',
        choices: ['yaml', 'json'],
        default: 'yaml',
      }),
  handler: async (argv) => {
    const { file, format } = argv;

    if (!fs.existsSync(file)) {
      console.error(`Error: File not found: ${file}`);
      process.exit(1);
    }

    const ext = path.extname(file).toLowerCase();

    if (ext !== '.exr' && ext !== '.hdr' && ext !== '.jpg' && ext !== '.jpeg') {
      console.error(`Error: Unsupported file format: ${ext}. Supported formats: .exr, .hdr, .jpg, .jpeg (gain map)`);
      process.exit(1);
    }

    try {
      const fileBuf = fs.readFileSync(file);
      const fileBuffer = new Uint8Array(fileBuf.buffer, fileBuf.byteOffset, fileBuf.byteLength);

      let imageData: HdrifyImage;
      if (ext === '.exr') {
        imageData = readExr(fileBuffer);
      } else if (ext === '.jpg' || ext === '.jpeg') {
        imageData = readJpegGainMap(fileBuffer);
      } else {
        imageData = readHdr(fileBuffer);
      }

      const output = buildInfoOutput(imageData, ext);

      if (format === 'json') {
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(stringifyYaml(output as unknown as Record<string, unknown>, 0));
      }
    } catch (error) {
      console.error(`Error reading file:`, error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },
});
