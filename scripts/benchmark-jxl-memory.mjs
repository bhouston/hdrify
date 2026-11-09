/** Peak memory of one JPEG XL encode of a deterministic synthetic RGBA image.
 * pnpm build
 * HDRIFY_JXL_EFFORT=high HDRIFY_JXL_LOSSY=1 node scripts/benchmark-jxl-memory.mjs
 * Set HDRIFY_JXL_MODULE to an absolute baseline dist/index.js; size defaults to 8192x4096.
 * The encode runs in a worker whose V8 heap plus external (typed array) memory is sampled
 * every 10 ms. peakEncodeMiB excludes the input image; peakRssMiB is the whole process.
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';

const mib = (bytes) => Math.round(bytes / 2 ** 20);
if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  let base = 0,
    peak = 0,
    timer;
  const sample = async () => {
    const s = await worker.getHeapStatistics().catch(() => undefined);
    if (s) peak = Math.max(peak, s.used_heap_size + s.external_memory);
  };
  worker.on('message', async (message) => {
    if (message === 'ready') {
      await sample();
      base = peak;
      timer = setInterval(sample, 10);
      worker.postMessage('go');
      return;
    }
    clearInterval(timer);
    console.log(
      JSON.stringify({
        ...message,
        peakEncodeMiB: mib(peak - base),
        peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
      }),
    );
    await worker.terminate();
  });
} else {
  const moduleUrl = process.env.HDRIFY_JXL_MODULE
    ? pathToFileURL(process.env.HDRIFY_JXL_MODULE)
    : new URL('../packages/hdrify/dist/index.js', import.meta.url);
  const { writeJxl } = await import(moduleUrl);
  const width = Number(process.env.HDRIFY_JXL_WIDTH ?? 8192);
  const height = Number(process.env.HDRIFY_JXL_HEIGHT ?? 4096);
  const effort = process.env.HDRIFY_JXL_EFFORT ?? 'standard';
  const lossy = process.env.HDRIFY_JXL_LOSSY === '1';
  const data = new Float32Array(width * height * 4);
  let seed = 1;
  const noise = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32 - 0.5) * 0.02;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      data[p] = (x + y) / 2048 + noise();
      data[p + 1] = Math.sin(x / 230) ** 2 * 12 + noise();
      data[p + 2] = ((x * 13 + y * 11) % 1024) / 32;
      data[p + 3] = 0.5 + 0.5 * Math.cos(y / 512);
    }
  const image = { width, height, data, linearColorSpace: 'linear-rec709' };
  parentPort.once('message', () => {
    const start = performance.now();
    const encoded = writeJxl(image, { effort, lossy, bitDepth: 'float16' });
    const elapsed = Math.round(performance.now() - start);
    parentPort.postMessage({
      width,
      height,
      effort,
      lossy,
      elapsed,
      encodedBytes: encoded.length,
      checksum: createHash('sha256').update(encoded).digest('hex').slice(0, 16),
    });
  });
  parentPort.postMessage('ready');
}
