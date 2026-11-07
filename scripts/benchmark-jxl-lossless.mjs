/**
 * Compare half-float lossless writers on identical, sanitized samples.
 * Usage: pnpm --filter hdrify build && node scripts/benchmark-jxl-lossless.mjs [assets/*.exr]
 * Optional baseline: HDRIFY_JXL_BASELINE=/absolute/path/to/old/dist/index.js
 * Requires cjxl on PATH. Output sizes are bytes; times are wall-clock milliseconds.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { ensureNonNegativeFinite, readExr, writeExr, writeJxl } from '../packages/hdrify/dist/index.js';

const baseline = process.env.HDRIFY_JXL_BASELINE
  ? (await import(pathToFileURL(resolve(process.env.HDRIFY_JXL_BASELINE)).href)).writeJxl
  : undefined;
const files = process.argv.slice(2);
if (!files.length)
  files.push(
    ...readdirSync('assets')
      .filter((f) => f.endsWith('.exr'))
      .map((f) => join('assets', f)),
  );
const version = spawnSync('cjxl', ['--version'], { encoding: 'utf8' });
if (version.status !== 0) throw new Error('Install cjxl (JPEG XL reference encoder) before benchmarking');
console.error(version.stdout.trim() || version.stderr.trim());
const dir = mkdtempSync(join(tmpdir(), 'hdrify-jxl-benchmark-'));
console.log(
  'file,width,height,hdrify_bytes,hdrify_ms,baseline_bytes,baseline_ms,exr_zip_bytes,cjxl_e2_bytes,cjxl_e7_bytes',
);
try {
  for (const file of files) {
    let image;
    try {
      image = readExr(readFileSync(file));
    } catch (error) {
      if (error instanceof Error && /Multi-part, tiled, and deep/.test(error.message)) {
        console.error(`Skipping ${file}: ${error.message}`);
        continue;
      }
      throw error;
    }
    ensureNonNegativeFinite(image.data);
    const zip = writeExr(image, { compression: 'zip' });
    const input = join(dir, 'input.exr');
    writeFileSync(input, zip);
    const encode = (writer) => {
      writer(image); // warm up
      const times = [];
      let bytes;
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        bytes = writer(image).length;
        times.push(performance.now() - start);
      }
      return [bytes, times.toSorted((a, b) => a - b)[1].toFixed(1)];
    };
    const current = encode(writeJxl);
    const old = baseline ? encode(baseline) : ['', ''];
    const sizes = [2, 7].map((effort) => {
      const output = join(dir, `e${effort}.jxl`);
      const result = spawnSync('cjxl', [input, output, '-d', '0', '-e', String(effort)], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`cjxl failed for ${file}: ${result.stderr}`);
      return statSync(output).size;
    });
    console.log([basename(file), image.width, image.height, ...current, ...old, zip.length, ...sizes].join(','));
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
