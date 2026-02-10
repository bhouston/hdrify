import * as fs from 'node:fs';
import * as path from 'node:path';
import { type FloatImageData, parseEXRFile, writeEXRFile } from 'exr-image';
import { parseHDRFile, writeHDRFile } from 'hdr-image';
import type { Argv } from 'yargs';

export const command = 'convert <input> <output>';
export const describe = 'Convert between EXR and HDR formats';
export const builder = (yargs: Argv) =>
  yargs
    .positional('input', {
      describe: 'Input file path (.exr or .hdr)',
      type: 'string',
      demandOption: true,
    })
    .positional('output', {
      describe: 'Output file path (.exr or .hdr)',
      type: 'string',
      demandOption: true,
    });

export const handler = async (argv: { input: string; output: string }) => {
  const { input, output } = argv;

  // Check if input file exists
  if (!fs.existsSync(input)) {
    console.error(`Error: Input file not found: ${input}`);
    process.exit(1);
  }

  // Detect formats from extensions
  const inputExt = path.extname(input).toLowerCase();
  const outputExt = path.extname(output).toLowerCase();

  if (inputExt !== '.exr' && inputExt !== '.hdr') {
    console.error(`Error: Unsupported input format: ${inputExt}. Supported formats: .exr, .hdr`);
    process.exit(1);
  }

  if (outputExt !== '.exr' && outputExt !== '.hdr') {
    console.error(`Error: Unsupported output format: ${outputExt}. Supported formats: .exr, .hdr`);
    process.exit(1);
  }

  try {
    // Read input file
    const inputBuffer = fs.readFileSync(input);
    console.log(`Reading ${inputExt} file: ${input}`);

    // Parse input file
    let imageData: FloatImageData;
    if (inputExt === '.exr') {
      imageData = parseEXRFile(inputBuffer);
    } else {
      imageData = parseHDRFile(inputBuffer);
    }

    console.log(`Image dimensions: ${imageData.width}x${imageData.height}`);

    // Write output file
    let outputBuffer: Buffer;
    if (outputExt === '.exr') {
      outputBuffer = writeEXRFile(imageData);
    } else {
      outputBuffer = writeHDRFile(imageData);
    }

    fs.writeFileSync(output, outputBuffer);
    console.log(`Successfully converted to ${outputExt} file: ${output}`);
  } catch (error) {
    console.error(`Error during conversion:`, error instanceof Error ? error.message : error);
    process.exit(1);
  }
};
