import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Not published to npm (see release.config.js: it's deliberately excluded
// from the @anolilab/semantic-release-pnpm array), but it shares the same
// version stream as the npm packages and ships through vsce/ovsx instead.
export const extensionPath = 'packages/hdrify-vscode-extension';

// Pin the extension's package.json to the shared release version, the same
// way @anolilab/semantic-release-pnpm does for the npm packages.
export function setVersion(version) {
  const pkgFile = resolve(extensionPath, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  pkg.version = version;
  writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
}

// Build, package, and publish the extension to both the VS Code Marketplace
// and Open VSX (the registry Cursor and other VS Code-compatible editors
// use). Requires VSCE_PAT / OVSX_PAT in the environment.
export function publish() {
  execFileSync('pnpm', ['--filter', 'hdrify-vscode-extension', 'run', 'build'], { stdio: 'inherit' });
  execFileSync('pnpm', ['--filter', 'hdrify-vscode-extension', 'exec', 'vsce', 'package', '--no-dependencies'], {
    stdio: 'inherit',
  });
  const vsix = resolve(
    extensionPath,
    `hdrify-vscode-extension-${JSON.parse(readFileSync(resolve(extensionPath, 'package.json'), 'utf8')).version}.vsix`,
  );
  execFileSync(
    'pnpm',
    [
      '--filter',
      'hdrify-vscode-extension',
      'exec',
      'vsce',
      'publish',
      '--packagePath',
      vsix,
      '--pat',
      process.env.VSCE_PAT,
    ],
    {
      stdio: 'inherit',
    },
  );
  execFileSync('npx', ['ovsx', 'publish', vsix, '--pat', process.env.OVSX_PAT], { stdio: 'inherit' });
}
