#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Bundle the webview preview script with esbuild.
 * Includes hdrify's applyToneMapping for canvas rendering.
 */
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'media');
const outFile = join(outDir, 'preview.js');

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

await esbuild.build({
  entryPoints: [join(root, 'src', 'preview', 'preview.ts')],
  bundle: true,
  outfile: outFile,
  format: 'iife',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

console.log('Built preview.js');
