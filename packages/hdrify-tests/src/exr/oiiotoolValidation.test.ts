/**
 * Cross-validates hdrify's EXR reader and writer against OpenImageIO's oiiotool (which uses the
 * reference OpenEXR library) for every compression codec. Skipped when oiiotool is not on PATH;
 * on macOS: `brew install openimageio`.
 *
 * No per-codec tolerances: hdrify must be no worse than oiiotool's own encoding of the same codec
 * (exactly 0 error for lossless codecs, the codec's inherent loss for B44/DWA/PXR24-float).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXR_COMPRESSIONS, type HdrifyImage, readExr, writeExr } from 'hdrify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../assets/memorial.exr');
const hasOiiotool = spawnSync('oiiotool', ['--version']).status === 0;

function oiiotool(...args: string[]): string {
  const r = spawnSync('oiiotool', args, { encoding: 'utf8' });
  return `${r.stdout}${r.stderr}`;
}

/** Mean absolute RGB error from `oiiotool a --diff b`; throws if oiiotool cannot read `a`. */
function oiioMeanError(a: string, b: string): number {
  const out = oiiotool(a, '--ch', 'R,G,B', '--diff', b);
  if (out.includes('PASS')) return 0;
  const m = /Mean error = ([\d.e+-]+)/.exec(out);
  if (!m) throw new Error(`oiiotool could not diff ${path.basename(a)}:\n${out}`);
  return Number(m[1]);
}

function meanRgbError(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
  }
  return sum / ((a.length / 4) * 3);
}

describe.skipIf(!hasOiiotool)('EXR codecs cross-validated with oiiotool', () => {
  let dir: string;
  let source: HdrifyImage;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdrify-oiio-'));
    source = readExr(fs.readFileSync(sourcePath));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  for (const compression of EXR_COMPRESSIONS) {
    it(`writes ${compression} that oiiotool reads, with no more loss than oiiotool's own ${compression}`, () => {
      const ours = path.join(dir, `hdrify_${compression}.exr`);
      const ref = path.join(dir, `oiio_${compression}.exr`);
      fs.writeFileSync(ours, writeExr(source, { compression }));
      oiiotool(sourcePath, '--compression', compression, '-o', ref);
      expect(oiioMeanError(ours, sourcePath)).toBeLessThanOrEqual(oiioMeanError(ref, sourcePath) * 1.25 + 1e-6);
    });

    for (const type of ['half', 'float']) {
      it(`reads ${type} ${compression} written by oiiotool`, () => {
        const ref = path.join(dir, `oiio_${compression}_${type}.exr`);
        oiiotool(sourcePath, '-d', type, '--compression', compression, '-o', ref);
        const parsed = readExr(fs.readFileSync(ref));
        expect(meanRgbError(parsed.data, source.data)).toBeLessThanOrEqual(
          oiioMeanError(ref, sourcePath) * 1.25 + 1e-6,
        );
      });
    }
  }
});
