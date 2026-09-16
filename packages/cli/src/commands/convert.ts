import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  applyToneMapping,
  convertLinearColorSpace,
  encodeGainMap,
  EXR_COMPRESSIONS,
  type HdrifyImage,
  readExr,
  readHdr,
  readJpegGainMap,
  RESIZE_FILTERS,
  resizeImage,
  writeExr,
  writeHdr,
  writeJpegGainMap,
} from 'hdrify';
import sharp from 'sharp';
import { defineCommand } from 'yargs-file-commands';

const SDR_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg'] as const;
const HDR_EXTENSIONS = ['.exr', '.hdr'] as const;

function isSdrExtension(ext: string): ext is (typeof SDR_EXTENSIONS)[number] {
  return SDR_EXTENSIONS.includes(ext as (typeof SDR_EXTENSIONS)[number]);
}

function isHdrExtension(ext: string): ext is '.exr' | '.hdr' {
  return ext === '.exr' || ext === '.hdr';
}

function isJpegGainMapExtension(ext: string): ext is '.jpg' | '.jpeg' {
  return ext === '.jpg' || ext === '.jpeg';
}

/** Parse "1024,512" (WxH) or "1024" (square) into { width, height }. */
function parseSize(size: string): { width: number; height: number } {
  const parts = size.split(',').map((p) => Number(p.trim()));
  if (parts.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new Error(`Invalid --size value: ${size}. Expected "WIDTH,HEIGHT" or "SIZE".`);
  }
  const [width, height] = parts;
  if (parts.length === 1) return { width: width!, height: width! };
  if (parts.length === 2) return { width: width!, height: height! };
  throw new Error(`Invalid --size value: ${size}. Expected "WIDTH,HEIGHT" or "SIZE".`);
}

export const command = defineCommand({
  command: 'convert <input> <output>',
  describe: 'Convert between EXR, HDR, JPEG gain map (Ultra HDR / Adobe), and SDR formats (PNG, WebP, JPEG)',
  builder: (yargs) =>
    yargs
      .positional('input', {
        describe: 'Input file path (.exr, .hdr, or .jpg/.jpeg with gain map)',
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
        describe: 'Gain map encoding gamma (JPEG gain map output only); LDR PNG/WebP use sRGB',
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
        choices: EXR_COMPRESSIONS,
      })
      .option('format', {
        describe: 'JPEG gain map format: ultrahdr (default) or adobe-gainmap (JPEG output only)',
        type: 'string',
        choices: ['ultrahdr', 'adobe-gainmap'],
      })
      .option('size', {
        describe: 'Resize output to WIDTH,HEIGHT (e.g. 1024,512) or SIZE for a square (e.g. 1024)',
        type: 'string',
      })
      .option('filter', {
        describe: 'Resize filter (used with --size)',
        type: 'string',
        choices: RESIZE_FILTERS,
        default: 'lanczos' as const,
      }),
  handler: async (argv) => {
    const { input, output, tonemapping, gamma, exposure, quality, compression, format, size, filter } = argv;

    if (!fs.existsSync(input)) {
      console.error(`Error: Input file not found: ${input}`);
      process.exit(1);
    }

    const inputExt = path.extname(input).toLowerCase();
    const outputExt = path.extname(output).toLowerCase();

    if (inputExt !== '.exr' && inputExt !== '.hdr' && !isJpegGainMapExtension(inputExt)) {
      console.error(
        `Error: Unsupported input format: ${inputExt}. Supported formats: .exr, .hdr, .jpg, .jpeg (gain map)`,
      );
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

    if (format !== undefined && format !== null && !isJpegGainMapExtension(outputExt)) {
      console.error(`Error: --format is only valid for JPEG output. Output format is ${outputExt}.`);
      process.exit(1);
    }

    try {
      const inputBuf = fs.readFileSync(input);
      const inputBuffer = new Uint8Array(inputBuf.buffer, inputBuf.byteOffset, inputBuf.byteLength);
      console.log(`Reading ${inputExt} file: ${input}`);

      let imageData: HdrifyImage;
      if (inputExt === '.exr') {
        imageData = readExr(inputBuffer);
      } else if (isJpegGainMapExtension(inputExt)) {
        imageData = readJpegGainMap(inputBuffer);
      } else {
        imageData = readHdr(inputBuffer);
      }

      console.log(`Image dimensions: ${imageData.width}x${imageData.height}`);

      if (size !== undefined) {
        const { width, height } = parseSize(size);
        imageData = resizeImage(imageData, { width, height, filter: filter as (typeof RESIZE_FILTERS)[number] });
        console.log(`Resized to: ${imageData.width}x${imageData.height} (${filter})`);
      }

      if (isHdrExtension(outputExt)) {
        // HDR output: convert Rec 2020 to linear sRGB for HDR (Radiance assumes sRGB)
        let dataToWrite = imageData;
        if (outputExt === '.hdr' && imageData.linearColorSpace !== 'linear-rec709') {
          dataToWrite = convertLinearColorSpace(imageData, 'linear-rec709');
        }

        let outputBuffer: Uint8Array;
        if (outputExt === '.exr') {
          outputBuffer = writeExr(dataToWrite, { compression });
        } else {
          outputBuffer = writeHdr(dataToWrite);
        }
        fs.writeFileSync(output, outputBuffer);
      } else {
        // SDR output: tone mapping + format-specific encoding (LDR uses sRGB)
        if (outputExt === '.jpg' || outputExt === '.jpeg') {
          // JPEG: encodeGainMap + writeJpegGainMap (JPEG-R / Ultra HDR / Adobe gain map)
          const gammaVal = gamma ?? 1;
          const gammaTriple = [gammaVal, gammaVal, gammaVal] as [number, number, number];
          const encodingResult = encodeGainMap(imageData, {
            toneMapping: tonemapping as 'aces' | 'reinhard' | 'neutral' | 'agx',
            exposure,
            gamma: gammaTriple,
          });
          const jpegBuffer = writeJpegGainMap(encodingResult, {
            quality,
            format: (format ?? 'ultrahdr') as 'ultrahdr' | 'adobe-gainmap',
          });
          fs.writeFileSync(output, jpegBuffer);
        } else {
          // PNG / WebP: applyToneMapping (sRGB) + sharp
          const ldrRgb = applyToneMapping(imageData.data, imageData.width, imageData.height, {
            toneMapping: tonemapping as 'aces' | 'reinhard' | 'neutral' | 'agx',
            exposure,
            metadata: imageData.metadata,
            sourceColorSpace: imageData.linearColorSpace,
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
