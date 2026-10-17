import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Use the built CLI's existing clidoc/yargs integration as the single source of
// command arguments, options, choices, descriptions, and defaults.
const output = new URL('../.generated/hdrify.opencli.json', import.meta.url);
mkdirSync(new URL('.', output), { recursive: true });
execFileSync(
  process.execPath,
  [
    fileURLToPath(new URL('../../cli/dist/index.js', import.meta.url)),
    'docgen',
    '--format',
    'json',
    '--output',
    fileURLToPath(output),
  ],
  { stdio: 'inherit' },
);
