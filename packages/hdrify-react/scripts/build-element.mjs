// Self-contained <image-viewer> bundle (React, react-dom and hdrify included) for CDN and <script> use.
import { build } from 'esbuild';

await build({
  entryPoints: [new URL('../src/element.ts', import.meta.url).pathname],
  outfile: new URL('../dist/image-viewer.js', import.meta.url).pathname,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
});
