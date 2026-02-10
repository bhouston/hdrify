import * as fs from 'node:fs';
import * as path from 'node:path';
import { type FloatImageData, parseEXRFile } from 'exr-image';
import { parseHDRFile } from 'hdr-image';
import type { Argv } from 'yargs';

// Compression type names for EXR
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

export const command = 'info <file>';
export const describe = 'Display metadata about an EXR or HDR file';
export const builder = (yargs: Argv) =>
  yargs.positional('file', {
    describe: 'Input file path (.exr or .hdr)',
    type: 'string',
    demandOption: true,
  });

export const handler = async (argv: { file: string }) => {
  const { file } = argv;

  // Check if file exists
  if (!fs.existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }

  // Detect format from extension
  const ext = path.extname(file).toLowerCase();

  if (ext !== '.exr' && ext !== '.hdr') {
    console.error(`Error: Unsupported file format: ${ext}. Supported formats: .exr, .hdr`);
    process.exit(1);
  }

  try {
    // Read and parse file
    const fileBuffer = fs.readFileSync(file);
    let imageData: FloatImageData;
    let compression: number | undefined;

    if (ext === '.exr') {
      // Parse the full file to get image data
      imageData = parseEXRFile(fileBuffer);

      // Parse compression from header
      const dataView = new DataView(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
      let offset = 8; // Skip magic (4) and version (4)

      // Read header attributes to find compression
      while (offset < fileBuffer.length) {
        const attributeName = readNullTerminatedString(fileBuffer, offset);
        offset += attributeName.length + 1;

        if (attributeName === '') {
          break; // End of header
        }

        const attributeType = readNullTerminatedString(fileBuffer, offset);
        offset += attributeType.length + 1;

        const attributeSize = dataView.getUint32(offset, true);
        offset += 4;

        if (attributeName === 'compression' && attributeType === 'compression') {
          compression = dataView.getUint8(offset);
          break;
        }

        offset += attributeSize;
      }
    } else {
      imageData = parseHDRFile(fileBuffer);
    }

    // Display metadata
    console.log('\nFile Information:');
    console.log('==================');
    console.log(`Format: ${ext.toUpperCase().slice(1)}`);
    console.log(`Width: ${imageData.width} pixels`);
    console.log(`Height: ${imageData.height} pixels`);

    if (imageData.exposure !== undefined) {
      console.log(`Exposure: ${imageData.exposure}`);
    }

    if (imageData.gamma !== undefined) {
      console.log(`Gamma: ${imageData.gamma}`);
    }

    if (ext === '.exr' && compression !== undefined) {
      const compressionName = COMPRESSION_NAMES[compression] || `UNKNOWN (${compression})`;
      console.log(`Compression: ${compressionName}`);
    }

    console.log('');
  } catch (error) {
    console.error(`Error reading file:`, error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

function readNullTerminatedString(buffer: Buffer, offset: number): string {
  const bytes: number[] = [];
  let pos = offset;
  while (pos < buffer.length) {
    const byte = buffer[pos];
    if (byte === undefined) {
      break;
    }
    if (byte === 0) {
      break;
    }
    bytes.push(byte);
    pos++;
  }
  return Buffer.from(bytes).toString('utf-8');
}
