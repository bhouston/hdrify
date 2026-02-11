import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompareFloatImagesResult, FloatImageData, MismatchSample } from 'hdrify';
import { compareFloatImages, createHsvRainbowImage, readExr } from 'hdrify';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../../..');
const rainbowPath = path.join(workspaceRoot, 'assets', 'example_zip.exr');

const CREATE_TEST_DEFAULTS = { width: 16, height: 16, value: 1, intensity: 1 };
const TOLERANCE = { tolerancePercent: 0.01, includeMismatchSamples: 10 };

function formatPixel(x: number, y: number, img: FloatImageData): string {
  const i = (y * img.width + x) * 4;
  const r = img.data[i] ?? 0;
  const g = img.data[i + 1] ?? 0;
  const b = img.data[i + 2] ?? 0;
  const a = img.data[i + 3] ?? 0;
  return `(${x},${y}) RGBA=[${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)}, ${a.toFixed(4)}]`;
}

function formatDiagnostics(
  result: CompareFloatImagesResult,
  reference: FloatImageData,
  parsed: FloatImageData,
): string {
  const lines: string[] = [
    `Dimensions: reference=${reference.width}x${reference.height}, parsed=${parsed.width}x${parsed.height}`,
    `maxDiff=${result.maxDiff}, mismatchedPixels=${result.mismatchedPixels}`,
    '',
    'Corner samples (reference, parsed):',
    `  (0,0)   ref: ${formatPixel(0, 0, reference)}`,
    `  (0,0)   act: ${formatPixel(0, 0, parsed)}`,
    `  (15,0)  ref: ${formatPixel(15, 0, reference)}`,
    `  (15,0)  act: ${formatPixel(15, 0, parsed)}`,
    `  (0,15)  ref: ${formatPixel(0, 15, reference)}`,
    `  (0,15)  act: ${formatPixel(0, 15, parsed)}`,
    `  (15,15) ref: ${formatPixel(15, 15, reference)}`,
    `  (15,15) act: ${formatPixel(15, 15, parsed)}`,
  ];

  if (result.mismatchSamples && result.mismatchSamples.length > 0) {
    lines.push('', 'First mismatched pixels:');
    for (const s of result.mismatchSamples as MismatchSample[]) {
      lines.push(
        `  [${s.pixelIndex}] (${s.x},${s.y}) expected RGBA=[${s.expected.map((v) => v.toFixed(4)).join(', ')}] actual=[${s.actual.map((v) => v.toFixed(4)).join(', ')}]`,
      );
    }
  }

  return lines.join('\n');
}

describe('example_zip.exr diagnostic', () => {
  it('reads example_zip.exr and compares to synthetic 16x16', () => {
    if (!fs.existsSync(rainbowPath)) return;

    const reference = createHsvRainbowImage(CREATE_TEST_DEFAULTS);
    const refBuffer = new Uint8Array(fs.readFileSync(rainbowPath));
    const parsed = readExr(refBuffer);

    const result = compareFloatImages(reference, parsed, TOLERANCE);

    if (!result.match) {
      const msg = formatDiagnostics(result, reference, parsed);
      expect(result.match, msg).toBe(true);
    } else {
      expect(result.match).toBe(true);
    }
  });
});
