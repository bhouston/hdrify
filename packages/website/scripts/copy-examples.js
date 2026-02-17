import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const assetsDir = join(__dirname, '../../../assets');
const destDir = join(__dirname, '../public/examples');

if (!existsSync(assetsDir)) {
  console.warn('copy-examples: assets dir not found at', assetsDir);
  process.exit(0);
}

if (!existsSync(destDir)) {
  mkdirSync(destDir, { recursive: true });
}

const entries = readdirSync(assetsDir, { withFileTypes: true });
let copied = 0;
for (const entry of entries) {
  if (!entry.isFile()) continue;
  const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf('.'));
  if (ext !== '.hdr' && ext !== '.exr' && ext !== '.jpg' && ext !== '.jpeg') continue;
  const src = join(assetsDir, entry.name);
  const dest = join(destDir, entry.name);
  cpSync(src, dest, { force: true });
  copied++;
}
console.log(`copy-examples: copied ${copied} example file(s) to public/examples`);
