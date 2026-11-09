import { promises as fs, readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  createGradientImage,
  encodeGainMap,
  readExr,
  readHdr,
  readJpegGainMap,
  readJxl,
  writeExr,
  writeHdr,
  writeJpegGainMap,
  writeJxl,
} from 'hdrify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const source = createGradientImage({ width: 16, height: 8, mode: 'horizontal', min: 0.125, max: 4 });
const inputs = {
  exr: writeExr(source),
  hdr: writeHdr(source),
  jpg: writeJpegGainMap(encodeGainMap(source)),
  jxl: writeJxl(source, { bitDepth: 'float32' }),
};
const commands = {
  exr: 'hdrify.convertToExr',
  hdr: 'hdrify.convertToHdr',
  jpg: 'hdrify.convertToUltraHdrJpeg',
  jxl: 'hdrify.convertToJxl',
};
const readers = { exr: readExr, hdr: readHdr, jpg: readJpegGainMap, jxl: readJxl };
type Format = keyof typeof inputs;
const formats = Object.keys(inputs) as Format[];
const pairs = formats.flatMap((from) => formats.filter((to) => to !== from).map((to) => ({ from, to })));
const uri = (fsPath: string) => ({ fsPath, toString: () => fsPath });

let directory: string;
let settings: Record<string, unknown>;
let registered: Map<string, (resource: ReturnType<typeof uri>, selected?: ReturnType<typeof uri>[]) => Promise<void>>;
let failures: string[];
let progress: number[];

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hdrify-vscode-convert-'));
  settings = { leaveOriginalWhenChangingFormat: true, jxlBitDepth: 'float32' };
  registered = new Map();
  failures = [];
  progress = [];
  const api = {
    workspace: {
      fs: {
        readFile: (resource: ReturnType<typeof uri>) => fs.readFile(resource.fsPath),
        writeFile: (resource: ReturnType<typeof uri>, bytes: Uint8Array) => fs.writeFile(resource.fsPath, bytes),
      },
      getConfiguration: () => ({ get: (key: string, fallback: unknown) => settings[key] ?? fallback }),
    },
    Uri: { file: uri },
    window: {
      createOutputChannel: () => ({}),
      registerCustomEditorProvider: () => ({}),
      showInformationMessage: () => {},
      showErrorMessage: (message: string) => {
        failures.push(message);
      },
      withProgress: (
        _options: unknown,
        run: (reporter: { report(value: { increment: number }): void }) => Promise<void>,
      ) =>
        run({
          report: ({ increment }) => {
            progress.push(increment);
          },
        }),
    },
    commands: {
      registerCommand: (
        name: string,
        run: (resource: ReturnType<typeof uri>, selected?: ReturnType<typeof uri>[]) => Promise<void>,
      ) => {
        registered.set(name, run);
        return {};
      },
    },
    ProgressLocation: { Notification: 15 },
  };
  // Exercise the shipped CJS bundle, including command filtering and workspace I/O.
  const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
  const load = loader._load;
  const require = createRequire(__filename);
  const bundlePath = path.resolve(__dirname, '../dist/extension.js');
  delete require.cache[bundlePath];
  loader._load = function (this: unknown, request: unknown, ...rest: unknown[]) {
    return request === 'vscode' ? api : load.call(this, request, ...rest);
  };
  try {
    require(bundlePath).activate({ subscriptions: [] });
  } finally {
    loader._load = load;
  }
});
afterEach(async () => fs.rm(directory, { recursive: true, force: true }));

async function convert(from: Format, to: Format, name = 'image') {
  const input = path.join(directory, `${name}.${from}`);
  await fs.writeFile(input, inputs[from]);
  await registered.get(commands[to])!(uri(input));
  const output = path.join(directory, `${name}.${to}`);
  return { input, output, image: readers[to](await fs.readFile(output)) };
}

describe('shipped conversion commands', () => {
  it.each(pairs)('converts $from to $to and preserves HDR values', async ({ from, to }) => {
    const { input, image } = await convert(from, to);
    expect([image.width, image.height]).toEqual([16, 8]);
    expect(image.data.every(Number.isFinite)).toBe(true);
    expect(Math.max(...image.data)).toBeGreaterThan(3);
    if (to === 'jxl') expect(image.data).toEqual(readers[from](inputs[from]).data);
    expect(await fs.readFile(input)).toEqual(Buffer.from(inputs[from]));
    expect(failures).toEqual([]);
  });

  it('offers all four output commands in the conversion submenu for JXL inputs', () => {
    const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    const menu = manifest.contributes.menus['hdrify.convertImage'];
    expect(menu.map((item: { command: string }) => item.command)).toEqual(
      expect.arrayContaining(Object.values(commands)),
    );
    for (const item of menu) expect(item.when).toContain('jxl');
    for (const command of Object.values(commands)) expect(registered.has(command)).toBe(true);
  });

  it('supports half-float output and keeps source samples when selecting float32', async () => {
    delete settings.jxlBitDepth;
    const half = await convert('hdr', 'jxl', 'half');
    expect(half.image.metadata?.bitsPerSample).toBe(16);
    settings.jxlBitDepth = 'float32';
    const full = await convert('hdr', 'jxl', 'full');
    expect(full.image.metadata?.bitsPerSample).toBe(32);
    expect(full.image.data).toEqual(readHdr(inputs.hdr).data);
  });

  it('accepts uppercase JXL filenames and detects the file by content', async () => {
    const input = path.join(directory, 'image.JXL');
    await fs.writeFile(input, inputs.exr);
    await registered.get(commands.hdr)!(uri(input));
    expect(readHdr(await fs.readFile(path.join(directory, 'image.hdr'))).width).toBe(16);
    expect(failures).toEqual([]);
  });

  it('deduplicates a batch of JXL inputs and reports completed progress', async () => {
    const first = uri(path.join(directory, 'first.jxl'));
    const second = uri(path.join(directory, 'second.jxl'));
    await fs.writeFile(first.fsPath, inputs.jxl);
    await fs.writeFile(second.fsPath, inputs.jxl);
    await registered.get(commands.exr)!(first, [first, second]);
    for (const name of ['first', 'second'])
      expect(readExr(await fs.readFile(path.join(directory, `${name}.exr`))).width).toBe(16);
    expect(progress).toEqual([50, 50]);
    expect(failures).toEqual([]);
  });

  it('keeps existing replace-original behavior after successful conversion', async () => {
    settings.leaveOriginalWhenChangingFormat = false;
    const { input, image } = await convert('hdr', 'jxl');
    expect(image.width).toBe(16);
    await expect(fs.stat(input)).rejects.toThrow(/ENOENT/);
  });

  it('preserves the source and reports malformed JXL without writing output', async () => {
    settings.leaveOriginalWhenChangingFormat = false;
    const input = path.join(directory, 'broken.jxl');
    await fs.writeFile(input, new Uint8Array([0xff, 0x0a]));
    await registered.get(commands.exr)!(uri(input));
    expect(failures).toHaveLength(1);
    expect((await fs.readFile(input)).length).toBe(2);
    await expect(fs.stat(path.join(directory, 'broken.exr'))).rejects.toThrow(/ENOENT/);
  });
});
