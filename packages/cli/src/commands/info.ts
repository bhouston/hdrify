import * as fs from 'node:fs';
import * as path from 'node:path';
import { type FloatImageData, readExr, readHdr } from 'hdrify';
import { defineCommand } from 'yargs-file-commands';

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

function readNullTerminatedString(buffer: Uint8Array, offset: number): string {
  const bytes: number[] = [];
  let pos = offset;
  while (pos < buffer.length) {
    const byte = buffer[pos];
    if (byte === undefined || byte === 0) break;
    bytes.push(byte);
    pos++;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export const command = defineCommand({
  command: 'info <file>',
  describe: 'Display metadata about an EXR or HDR file',
  builder: (yargs) =>
    yargs.positional('file', {
      describe: 'Input file path (.exr or .hdr)',
      type: 'string',
      demandOption: true,
    }),
  handler: async (argv) => {
    const { file } = argv;

    if (!fs.existsSync(file)) {
      console.error(`Error: File not found: ${file}`);
      process.exit(1);
    }

    const ext = path.extname(file).toLowerCase();

    if (ext !== '.exr' && ext !== '.hdr') {
      console.error(`Error: Unsupported file format: ${ext}. Supported formats: .exr, .hdr`);
      process.exit(1);
    }

    try {
      const fileBuf = fs.readFileSync(file);
      const fileBuffer = new Uint8Array(fileBuf.buffer, fileBuf.byteOffset, fileBuf.byteLength);
      let imageData: FloatImageData;
      let compression: number | undefined;

      if (ext === '.exr') {
        imageData = readExr(fileBuffer);

        const dataView = new DataView(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
        let offset = 8;

        while (offset < fileBuffer.length) {
          const attributeName = readNullTerminatedString(fileBuffer, offset);
          offset += attributeName.length + 1;

          if (attributeName === '') break;

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
        imageData = readHdr(fileBuffer);
      }

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
  },
});
