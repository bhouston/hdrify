#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve workspace package name -> version from the monorepo (pnpm-workspace.yaml layout). */
function getWorkspaceVersions(rootPath: string): Map<string, string> {
  const map = new Map<string, string>();
  const workspaceDirs = ['packages', 'demos'] as const;
  for (const dir of workspaceDirs) {
    const fullDir = join(rootPath, dir);
    if (!existsSync(fullDir) || !statSync(fullDir).isDirectory()) continue;
    for (const name of readdirSync(fullDir)) {
      const pkgDir = join(fullDir, name);
      const pkgPath = join(pkgDir, 'package.json');
      if (!statSync(pkgDir).isDirectory() || !existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.name && pkg.version) map.set(pkg.name, pkg.version);
    }
  }
  return map;
}

/** Replace workspace:* (and other workspace: protocol) deps with ^version from the workspace map. */
function resolveWorkspaceDeps(packageJson: Record<string, unknown>, workspaceVersions: Map<string, string>): void {
  // biome-ignore lint/security/noSecrets: package.json key names, not secrets
  const depKeys = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
  for (const key of depKeys) {
    const deps = packageJson[key] as Record<string, string> | undefined;
    if (!deps || typeof deps !== 'object') continue;
    for (const [pkgName, spec] of Object.entries(deps)) {
      // pnpm workspace protocol (workspace:*, workspace:^, etc.) — not a secret
      if (typeof spec !== 'string' || !spec.startsWith('workspace:')) continue;
      const version = workspaceVersions.get(pkgName);
      if (!version) {
        throw new Error(
          `Package "${pkgName}" is referenced as workspace:* but no package named "${pkgName}" was found in the monorepo. Publish that package first or add it to the workspace.`,
        );
      }
      deps[pkgName] = `^${version}`;
    }
  }
}

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

  // Replace workspace:* (and other workspace: protocol) deps with ^version from monorepo packages
  const workspaceVersions = getWorkspaceVersions(rootPath);
  if (workspaceVersions.size > 0) {
    console.log(`Resolving workspace dependencies from monorepo (${workspaceVersions.size} package(s))`);
    resolveWorkspaceDeps(packageJsonWithoutFiles, workspaceVersions);
  }

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

  const packageReadmePath = join(resolvedPackagePath, 'README.md');
  const readmePath = existsSync(packageReadmePath) ? packageReadmePath : join(rootPath, 'README.md');
  console.log(`Copying README from ${existsSync(packageReadmePath) ? 'package' : 'root'}`);
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
