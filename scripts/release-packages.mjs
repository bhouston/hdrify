import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export const packages = ['packages/hdrify', 'packages/cli', 'packages/hdrify-react'];

// Stage only the npm packages; the website and VS Code extension have separate delivery paths.
export function stagePackages(cwd, version) {
  const manifests = packages.map((path) => JSON.parse(readFileSync(resolve(cwd, path, 'package.json'), 'utf8')));
  const versions = new Map(manifests.map((pkg) => [pkg.name, version ?? pkg.version]));
  for (const [index, path] of packages.entries()) {
    const pkg = manifests[index];
    pkg.version = versions.get(pkg.name);
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        if (!range.startsWith('workspace:')) continue;
        if (!versions.has(name)) throw new Error(`Unpublished workspace dependency: ${name}`);
        pkg[field][name] = `^${versions.get(name)}`;
      }
    }
    delete pkg.scripts;
    delete pkg.devDependencies;
    pkg.files = ['dist', 'LICENSE', 'README.md'];
    const destination = resolve(cwd, path, 'publish');
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    cpSync(resolve(cwd, path, 'dist'), resolve(destination, 'dist'), {
      recursive: true,
      filter: (source) => !/\.(test|spec)\./.test(basename(source)),
    });
    cpSync(resolve(cwd, 'LICENSE'), resolve(destination, 'LICENSE'));
    cpSync(resolve(cwd, path, 'README.md'), resolve(destination, 'README.md'));
    writeFileSync(resolve(destination, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

export function verifyConditions(_config, { cwd }) {
  stagePackages(cwd);
}

export function prepare(_config, { cwd, nextRelease }) {
  stagePackages(cwd, nextRelease.version);
}
