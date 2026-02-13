/**
 * PXR24 decode regression test: example_pxr24.exr must match example_zip.exr (ground truth).
 * example_zip.exr is the same image re-saved by Blender in a different compression (ZIP).
 * Compares the full image with per-line diagnostics on mismatch.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompareFloatImagesResult, FloatImageData, MismatchSample } from 'hdrify';
import { compareFloatImages, readExr } from 'hdrify';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '../../../..');
const assetsDir = path.join(workspaceRoot, 'assets');
const pxr24Path = path.join(assetsDir, 'example_pxr24.exr');
const exampleZipPath = path.join(assetsDir, 'example_zip.exr');

// Half-float decode can differ slightly from float reference; allow small absolute tolerance.
const TOLERANCE = { tolerancePercent: 0.01, toleranceAbsolute: 0.0001, includeMismatchSamples: 15 };

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
  const w = reference.width;
  const h = reference.height;
  const lines: string[] = [
    `Dimensions: reference=${w}x${h}, parsed=${parsed.width}x${parsed.height}`,
    `maxDiff=${result.maxDiff}, mismatchedPixels=${result.mismatchedPixels}`,
    '',
    'Sample pixels by row (ref=example_zip.exr, actual=example_pxr24.exr decoded):',
  ];
  // Sample at (0,0), a few rows (0,1,2), block boundaries (16,17,32,33), and bottom
  const sampleYs = [0, 1, 2, 16, 17, 32, 33, h - 1].filter((y) => y < h);
  const sampleX = Math.min(0, w - 1);
  for (const y of sampleYs) {
    lines.push(`  y=${y} ref: ${formatPixel(sampleX, y, reference)}`);
    lines.push(`  y=${y} act: ${formatPixel(sampleX, y, parsed)}`);
  }
  lines.push(
    '',
    `  (${w >> 1},${h >> 1}) ref: ${formatPixel(w >> 1, h >> 1, reference)}`,
    `  (${w >> 1},${h >> 1}) act: ${formatPixel(w >> 1, h >> 1, parsed)}`,
  );

  if (result.mismatchSamples && result.mismatchSamples.length > 0) {
    lines.push('', 'First mismatched pixels (by position):');
    for (const s of result.mismatchSamples as MismatchSample[]) {
      lines.push(
        `  [${s.pixelIndex}] (${s.x},${s.y}) expected RGBA=[${s.expected.map((v) => v.toFixed(4)).join(', ')}] actual=[${s.actual.map((v) => v.toFixed(4)).join(', ')}]`,
      );
    }
  }

  return lines.join('\n');
}

describe('PXR24 decode vs ground truth (example_zip.exr)', () => {
  it('decoding example_pxr24.exr matches example_zip.exr (same image, different compression)', () => {
    const reference = readExr(new Uint8Array(fs.readFileSync(exampleZipPath)));
    const decodedPxr24 = readExr(new Uint8Array(fs.readFileSync(pxr24Path)));

    expect(decodedPxr24.width).toBe(reference.width);
    expect(decodedPxr24.height).toBe(reference.height);

    const result = compareFloatImages(reference, decodedPxr24, TOLERANCE);

    if (!result.match) {
      const msg = formatDiagnostics(result, reference, decodedPxr24);
      expect(result.match, msg).toBe(true);
    } else {
      expect(result.match).toBe(true);
    }
  });
});
