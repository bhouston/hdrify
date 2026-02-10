#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function main() {
  const packagePath = process.argv[2];

  if (!packagePath) {
    throw new Error('Error: Package path is required');
  }

  const resolvedPackagePath = resolve(packagePath);
  const publishPath = join(resolvedPackagePath, 'publish');
  const rootPath = resolve(__dirname, '..');

  // Verify package directory exists
  if (!existsSync(resolvedPackagePath)) {
    throw new Error(`Error: Package directory does not exist: ${resolvedPackagePath}`);
  }

  // Verify package.json exists
  const packageJsonPath = join(resolvedPackagePath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error(`Error: package.json not found in: ${resolvedPackagePath}`);
  }

  console.log(`Cleaning publish dir`);
  if (existsSync(publishPath)) {
    rmSync(publishPath, { recursive: true, force: true });
  }
  mkdirSync(publishPath, { recursive: true });

  console.log(`Building package`);
  execSync('pnpm -s build', { cwd: resolvedPackagePath, stdio: 'inherit' });

  console.log('Copying files to publish directory...');

  // Copy dist directory
  console.log(`Copying dist directory`);
  const distPath = join(resolvedPackagePath, 'dist');
  if (!existsSync(distPath)) {
    throw new Error(`Error: dist directory not found at ${distPath}`);
  }
  cpSync(distPath, join(publishPath, 'dist'), { recursive: true });

  // Copy package.json and remove the "files" field so .npmignore works properly
  console.log(`Copying package.json (removing files field)`);
  const packageJsonContent = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { files: _files, ...packageJsonWithoutFiles } = packageJsonContent;
  const publishPackageJsonPath = join(publishPath, 'package.json');
  writeFileSync(publishPackageJsonPath, `${JSON.stringify(packageJsonWithoutFiles, null, 2)}\n`);

  // Copy .npmignore
  console.log(`Copying .npmignore`);
  const npmignorePath = join(resolvedPackagePath, '.npmignore');
  if (existsSync(npmignorePath)) {
    cpSync(npmignorePath, join(publishPath, '.npmignore'));
  }

  console.log(`Copying LICENSE from root`);
  const licensePath = join(rootPath, 'LICENSE');
  if (!existsSync(licensePath)) {
    throw new Error(`Error: LICENSE not found at ${licensePath}`);
  }
  cpSync(licensePath, join(publishPath, 'LICENSE'));

  console.log(`Copying README from root`);
  const readmePath = join(rootPath, 'README.md');
  if (!existsSync(readmePath)) {
    throw new Error(`Error: README.md not found at ${readmePath}`);
  }
  cpSync(readmePath, join(publishPath, 'README.md'));

  console.log(`Publishing package`);
  execSync('npm publish ./publish/ --access public', {
    cwd: resolvedPackagePath,
    stdio: 'inherit',
  });

  console.log(`Release completed successfully!`);
}

try {
  main();
} catch (error) {
  console.error(`Error: Release failed: ${error}`);
  process.exit(1);
}
