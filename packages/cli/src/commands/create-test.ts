import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHsvRainbowImage, writeExr, writeHdr } from 'hdrify';
import { defineCommand } from 'yargs-file-commands';

export const command = defineCommand({
  command: 'create-test <output>',
  describe: 'Create a synthetic HSV rainbow test image (EXR or HDR)',
  builder: (yargs) =>
    yargs
      .positional('output', {
        describe: 'Output file path (.exr or .hdr only)',
        type: 'string',
        demandOption: true,
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
      }),
  handler: async (argv) => {
    const { output, width, height, value, intensity } = argv;

    const ext = path.extname(output).toLowerCase();

    if (ext !== '.exr' && ext !== '.hdr') {
      console.error(`Error: Unsupported output format: ${ext}. Only .exr and .hdr are supported for create-test.`);
      process.exit(1);
    }

    try {
      const imageData = createHsvRainbowImage({ width, height, value, intensity });

      let buffer: Uint8Array;
      if (ext === '.exr') {
        buffer = writeExr(imageData);
      } else {
        buffer = writeHdr(imageData);
      }

      fs.writeFileSync(output, buffer);
      console.log(`Created ${width}x${height} test image: ${output}`);
    } catch (error) {
      console.error(`Error creating test image:`, error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },
});
