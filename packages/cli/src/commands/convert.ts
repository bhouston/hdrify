import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  applyToneMapping,
  encodeGainMap,
  type FloatImageData,
  readExr,
  readHdr,
  writeExr,
  writeHdr,
  writeJpegGainMap,
} from 'hdrify';
import sharp from 'sharp';
import { defineCommand } from 'yargs-file-commands';

const SDR_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg'] as const;
const HDR_EXTENSIONS = ['.exr', '.hdr'] as const;

const EXR_COMPRESSION_CHOICES = ['none', 'rle', 'zip', 'zips', 'piz', 'pxr24'] as const;
const COMPRESSION_MAP: Record<(typeof EXR_COMPRESSION_CHOICES)[number], number> = {
  none: 0,
  rle: 1,
  zip: 3,
  zips: 2,
  piz: 4,
  pxr24: 5,
};

function isSdrExtension(ext: string): ext is (typeof SDR_EXTENSIONS)[number] {
  return SDR_EXTENSIONS.includes(ext as (typeof SDR_EXTENSIONS)[number]);
}

function isHdrExtension(ext: string): ext is '.exr' | '.hdr' {
  return ext === '.exr' || ext === '.hdr';
}

export const command = defineCommand({
  command: 'convert <input> <output>',
  describe: 'Convert between EXR, HDR, and SDR formats (PNG, WebP, JPEG)',
  builder: (yargs) =>
    yargs
      .positional('input', {
        describe: 'Input file path (.exr or .hdr)',
        type: 'string',
        demandOption: true,
      })
      .positional('output', {
        describe: 'Output file path (.exr, .hdr, .png, .webp, .jpg, .jpeg)',
        type: 'string',
        demandOption: true,
      })
      .option('tonemapping', {
        describe: 'Tone mapping for SDR output (aces, reinhard, neutral, agx)',
        type: 'string',
        choices: ['aces', 'reinhard', 'neutral', 'agx'],
        default: 'reinhard' as const,
      })
      .option('gamma', {
        describe: 'Gamma for SDR output (display gamma for PNG/WebP; gain map gamma for JPEG)',
        type: 'number',
      })
      .option('exposure', {
        describe: 'Exposure multiplier for SDR conversion',
        type: 'number',
        default: 1,
      })
      .option('quality', {
        describe: 'JPEG quality 0-100 (JPEG/JPEG-R output only)',
        type: 'number',
        default: 90,
      })
      .option('compression', {
        describe: 'EXR compression method (EXR output only, default: zip)',
        type: 'string',
        choices: EXR_COMPRESSION_CHOICES,
      }),
  handler: async (argv) => {
    const { input, output, tonemapping, gamma, exposure, quality, compression } = argv;

    if (!fs.existsSync(input)) {
      console.error(`Error: Input file not found: ${input}`);
      process.exit(1);
    }

    const inputExt = path.extname(input).toLowerCase();
    const outputExt = path.extname(output).toLowerCase();

    if (inputExt !== '.exr' && inputExt !== '.hdr') {
      console.error(`Error: Unsupported input format: ${inputExt}. Supported formats: .exr, .hdr`);
      process.exit(1);
    }

    const supportedOutput = [...HDR_EXTENSIONS, ...SDR_EXTENSIONS].join(', ');
    if (!isHdrExtension(outputExt) && !isSdrExtension(outputExt)) {
      console.error(`Error: Unsupported output format: ${outputExt}. Supported formats: ${supportedOutput}`);
      process.exit(1);
    }

    if (compression !== undefined && outputExt !== '.exr') {
      console.error(`Error: --compression is only valid for EXR output. Output format is ${outputExt}.`);
      process.exit(1);
    }

    try {
      const inputBuf = fs.readFileSync(input);
      const inputBuffer = new Uint8Array(inputBuf.buffer, inputBuf.byteOffset, inputBuf.byteLength);
      console.log(`Reading ${inputExt} file: ${input}`);

      let imageData: FloatImageData;
      if (inputExt === '.exr') {
        imageData = readExr(inputBuffer);
      } else {
        imageData = readHdr(inputBuffer);
      }

      console.log(`Image dimensions: ${imageData.width}x${imageData.height}`);

      if (isHdrExtension(outputExt)) {
        // HDR output: direct write
        let outputBuffer: Uint8Array;
        if (outputExt === '.exr') {
          const compressionOption =
            compression !== undefined ? { compression: COMPRESSION_MAP[compression] } : undefined;
          outputBuffer = writeExr(imageData, compressionOption);
        } else {
          outputBuffer = writeHdr(imageData);
        }
        fs.writeFileSync(output, outputBuffer);
      } else {
        // SDR output: tone mapping + format-specific encoding
        const gammaVal = gamma ?? (tonemapping === 'reinhard' ? 2.2 : 1);

        if (outputExt === '.jpg' || outputExt === '.jpeg') {
          // JPEG: encodeGainMap + writeJpegGainMap (JPEG-R / Ultra HDR)
          const gammaTriple = [gammaVal, gammaVal, gammaVal] as [number, number, number];
          const encodingResult = encodeGainMap(imageData, {
            toneMapping: tonemapping as 'aces' | 'reinhard' | 'neutral' | 'agx',
            exposure,
            gamma: gammaTriple,
          });
          const jpegBuffer = writeJpegGainMap(encodingResult, { quality });
          fs.writeFileSync(output, jpegBuffer);
        } else {
          // PNG / WebP: applyToneMapping + sharp
          const ldrRgb = applyToneMapping(imageData.data, imageData.width, imageData.height, {
            toneMapping: tonemapping as 'aces' | 'reinhard' | 'neutral' | 'agx',
            exposure,
            gamma: gammaVal,
            metadata: imageData.metadata,
          });
          const pipeline = sharp(ldrRgb, {
            raw: { width: imageData.width, height: imageData.height, channels: 3 },
          });
          if (outputExt === '.png') {
            await pipeline.png().toFile(output);
          } else {
            await pipeline.webp().toFile(output);
          }
        }
      }

      console.log(`Successfully converted to ${outputExt} file: ${output}`);
    } catch (error) {
      console.error(`Error during conversion:`, error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },
});
