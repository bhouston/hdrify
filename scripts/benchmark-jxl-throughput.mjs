/** Warmed, whole-image JPEG XL throughput; run each version in a separate process.
 * pnpm build
 * HDRIFY_JXL_SOURCE=memorial HDRIFY_JXL_OPERATION=decode node scripts/benchmark-jxl-throughput.mjs
 * Set HDRIFY_JXL_MODULE to an absolute baseline dist/index.js; effort defaults to standard.
 * Inputs are assets/<source>.exr, or the deterministic synthetic case. Durations are milliseconds.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const moduleUrl = process.env.HDRIFY_JXL_MODULE
  ? pathToFileURL(process.env.HDRIFY_JXL_MODULE)
  : new URL('../packages/hdrify/dist/index.js', import.meta.url);
const { readExr, writeJxl, readJxl } = await import(moduleUrl);
const source = process.env.HDRIFY_JXL_SOURCE ?? 'memorial';
const operation = process.env.HDRIFY_JXL_OPERATION ?? 'decode';
const effort = process.env.HDRIFY_JXL_EFFORT ?? 'standard';
const duration = Number(process.env.HDRIFY_JXL_DURATION ?? 5000);
const warmup = Number(process.env.HDRIFY_JXL_WARMUP ?? 1500);
if (
  !['encode', 'decode'].includes(operation) ||
  !Number.isFinite(duration) ||
  !(duration > 0) ||
  !Number.isFinite(warmup) ||
  !(warmup >= 0)
)
  throw new Error('Use encode/decode, a positive duration and a nonnegative warmup.');
let image;
if (source === 'synthetic') {
  const width = 256,
    height = 256,
    data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      data[p] = (x + y) / 8;
      data[p + 1] = Math.sin(x / 23) ** 2 * 12;
      data[p + 2] = ((x * 13 + y * 11) % 1024) / 32;
      data[p + 3] = 1;
    }
  image = { width, height, data, linearColorSpace: 'linear-rec709' };
} else image = readExr(readFileSync(new URL(`assets/${source}.exr`, pathToFileURL(root))));
const encoded = writeJxl(image, { effort });
const run = operation === 'decode' ? () => readJxl(encoded) : () => writeJxl(image, { effort });
let result,
  count = 0;
const warmStart = performance.now();
while (performance.now() - warmStart < warmup) result = run();
const start = performance.now();
while (performance.now() - start < duration) {
  result = run();
  count++;
}
const elapsed = performance.now() - start;
const output = operation === 'decode' ? result.data : result;
const checksum = createHash('sha256')
  .update(Buffer.from(output.buffer, output.byteOffset, output.byteLength))
  .digest('hex');
console.log(
  JSON.stringify({
    source,
    width: image.width,
    height: image.height,
    operation,
    effort,
    count,
    elapsed,
    operationsPerSecond: (count * 1000) / elapsed,
    encodedBytes: encoded.length,
    checksum,
  }),
);
