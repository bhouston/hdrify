import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHsvRainbowImage, writeExr, writeHdr } from 'hdrify';
import { defineCommand } from 'yargs-file-commands';

const REFERENCE_COMPRESSION_CHOICES = ['rle', 'zip', 'piz', 'pxr24'] as const;
const COMPRESSION_MAP: Record<(typeof REFERENCE_COMPRESSION_CHOICES)[number], number> = {
  rle: 1,
  zip: 3,
  piz: 4,
  pxr24: 5,
};

export const command = defineCommand({
  command: 'reference <output>',
  describe: 'Create a synthetic reference test image (EXR or HDR)',
  builder: (yargs) =>
    yargs
      .positional('output', {
        describe: 'Output file path (.exr or .hdr only)',
        type: 'string',
        demandOption: true,
      })
      .option('type', {
        describe: 'Type of reference image',
        type: 'string',
        choices: ['rainbow'] as const,
        default: 'rainbow',
      })
      .option('width', {
        describe: 'Image width',
        type: 'number',
        default: 16,
      })
      .option('height', {
        describe: 'Image height',
        type: 'number',
        default: 16,
      })
      .option('value', {
        describe: 'HSV value (0-1)',
        type: 'number',
        default: 1.0,
      })
      .option('intensity', {
        describe: 'HDR intensity multiplier',
        type: 'number',
        default: 1.0,
      })
      .option('compression', {
        describe: 'EXR compression method (EXR output only, default: zip)',
        type: 'string',
        choices: REFERENCE_COMPRESSION_CHOICES,
      }),
  handler: async (argv) => {
    const { output, width, height, value, intensity, compression } = argv;

    const ext = path.extname(output).toLowerCase();

    if (ext !== '.exr' && ext !== '.hdr') {
      console.error(`Error: Unsupported output format: ${ext}. Only .exr and .hdr are supported for reference.`);
      process.exit(1);
    }

    if (compression !== undefined && ext !== '.exr') {
      console.error(`Error: --compression is only valid for EXR output. Output format is ${ext}.`);
      process.exit(1);
    }

    try {
      const imageData = createHsvRainbowImage({ width, height, value, intensity });

      let buffer: Uint8Array;
      if (ext === '.exr') {
        const compressionOpt = compression !== undefined ? { compression: COMPRESSION_MAP[compression] } : undefined;
        buffer = writeExr(imageData, compressionOpt);
      } else {
        buffer = writeHdr(imageData);
      }

      fs.writeFileSync(output, buffer);
      console.log(`Created ${width}x${height} reference image: ${output}`);
    } catch (error) {
      console.error(`Error creating reference image:`, error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },
});
