/**
 * Usage: pnpm --filter hdrify build && node scripts/benchmark-jxl-lossy.mjs [assets/*.exr]
 * Requires cjxl/djxl. Compares the native fixed-DCT8 encoder with cjxl -e 3 at
 * distances 0.5, 1 and 2, decoding both with djxl. These distance scales have
 * different perceptual calibration, so always compare errors as well as sizes.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { readExr, writeExr, writeJxl } from '../packages/hdrify/dist/index.js';

function pfm(file) {
  const bytes = readFileSync(file);
  const m = /^PF\s+(\d+)\s+(\d+)\s+(-?[\d.]+)\s/.exec(bytes.subarray(0, 64).toString('latin1'));
  if (!m) throw new Error('Expected RGB PFM');
  const width = Number(m[1]),
    height = Number(m[2]);
  const data = new Float32Array(width * height * 3);
  const view = new DataView(bytes.buffer, bytes.byteOffset + m[0].length);
  for (let y = 0; y < height; y++)
    for (let i = 0; i < width * 3; i++) {
      data[y * width * 3 + i] = view.getFloat32(((height - y - 1) * width * 3 + i) * 4, Number(m[3]) < 0);
    }
  return data;
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr}`);
}
const srgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function errors(source, decoded) {
  let mse = 0,
    srgbMse = 0,
    max = 0,
    peak = 0;
  for (let i = 0; i < decoded.length; i++) {
    const want = source[Math.floor(i / 3) * 4 + (i % 3)];
    const d = decoded[i] - want;
    peak = Math.max(peak, want);
    max = Math.max(max, Math.abs(d));
    mse += d * d;
    const s = srgb(Math.max(0, decoded[i])) - srgb(want);
    srgbMse += s * s;
  }
  return [
    max.toPrecision(5),
    (10 * Math.log10((peak * peak * decoded.length) / mse)).toFixed(2),
    (10 * Math.log10((srgb(peak) ** 2 * decoded.length) / srgbMse)).toFixed(2),
  ];
}
const files = process.argv.slice(2);
if (!files.length) files.push('assets/example_halfs.exr', 'assets/reference_gradient.exr', 'assets/memorial.exr');
const dir = mkdtempSync(join(tmpdir(), 'hdrify-jxl-lossy-'));
console.log('file,distance,encoder,bytes,max_linear_error,linear_psnr_peak_db,srgb_psnr_peak_db');
try {
  for (const file of files) {
    const exr = writeExr(readExr(readFileSync(file)));
    const source = readExr(exr); // identical half-float source for both encoders
    const input = join(dir, 'input.exr');
    writeFileSync(input, exr);
    for (const distance of [0.5, 1, 2]) {
      for (const encoder of ['hdrify', 'cjxl_e3']) {
        const out = join(dir, 'out.jxl'),
          decoded = join(dir, 'out.pfm');
        if (encoder === 'hdrify') writeFileSync(out, writeJxl(source, { lossy: true, distance }));
        else run('cjxl', [input, out, '-e', '3', '-d', String(distance)]);
        run('djxl', [out, decoded]);
        console.log(
          [basename(file), distance, encoder, statSync(out).size, ...errors(source.data, pfm(decoded))].join(','),
        );
      }
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
