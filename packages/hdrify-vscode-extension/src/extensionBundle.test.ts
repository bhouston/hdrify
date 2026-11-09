import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { HdrPreviewProvider } from './hdrPreviewProvider.js';
import type { HdrPreviewDocument } from './hdrPreviewDocument.js';
import type * as vscode from 'vscode';
import { expect, it } from 'vitest';

// Loads the built bundle (what ships), not the TS source, so packaging/interop
// breakage like `x_1.default is not a function` fails here instead of in users' editors.
// Requires `pnpm build` first (CI runs it before `pnpm test`).
type Loader = { _load: (...args: unknown[]) => unknown };
const loader = Module as unknown as Loader;

// Any property is a callable stub returning another stub: enough for activate() to run.
const stub = (): object =>
  new Proxy(function () {}, { get: (_t, key) => (key === 'then' ? undefined : stub()), apply: stub, construct: stub });
// esbuild's interop copies own keys of the required module, so the namespaces must be real properties.
const vscodeStub = Object.fromEntries(
  ['window', 'workspace', 'commands', 'env', 'Uri', 'ProgressLocation', 'ViewColumn', 'Disposable', 'EventEmitter'].map(
    (k) => [k, stub()],
  ),
);

it('built extension bundle loads and activates', () => {
  const load = loader._load;
  loader._load = function (this: unknown, request: unknown, ...rest: unknown[]) {
    return request === 'vscode' ? vscodeStub : load.call(this, request, ...rest);
  };
  try {
    const bundle = createRequire(__filename)(path.resolve(__dirname, '../dist/extension.js'));
    const context = { subscriptions: [] as unknown[], extensionUri: stub(), extensionPath: '' };
    expect(() => bundle.activate(context)).not.toThrow();
    expect(context.subscriptions.length).toBeGreaterThan(0);
  } finally {
    loader._load = load;
  }
});

it('built preview host sends encoded JXL after the webview ready handshake', async () => {
  const bytes = readFileSync(path.resolve(__dirname, '../../../assets/jxl/lossless_float32.jxl'));
  let provider: HdrPreviewProvider | undefined;
  const api = {
    ...vscodeStub,
    workspace: { fs: { readFile: async () => bytes } },
    window: {
      createOutputChannel: stub,
      registerCustomEditorProvider: (_id: string, instance: HdrPreviewProvider) => {
        provider = instance;
        return stub();
      },
    },
    Uri: { joinPath: (...parts: unknown[]) => parts.join('/') },
  };
  const load = loader._load;
  const require = createRequire(__filename);
  const bundlePath = path.resolve(__dirname, '../dist/extension.js');
  delete require.cache[bundlePath];
  loader._load = function (this: unknown, request: unknown, ...rest: unknown[]) {
    return request === 'vscode' ? api : load.call(this, request, ...rest);
  };
  try {
    require(bundlePath).activate({ subscriptions: [], extensionUri: 'extension' });
  } finally {
    loader._load = load;
  }
  expect(provider).toBeDefined();
  const document: HdrPreviewDocument = await provider!.openCustomDocument({
    fsPath: '/test/renamed.JXL',
  } as vscode.Uri);
  expect(new Uint8Array(document.data)).toEqual(new Uint8Array(bytes));
  const sent: unknown[] = [];
  let receive: ((message: { type: string }) => void) | undefined;
  let dispose: (() => void) | undefined;
  let disposed = false;
  let html = '';
  const webview = {
    options: {},
    cspSource: 'vscode-resource:',
    asWebviewUri: (uri: unknown) => ({ toString: () => String(uri) }),
    postMessage: (message: unknown) => {
      sent.push(message);
      return Promise.resolve(true);
    },
    onDidReceiveMessage: (listener: typeof receive) => {
      receive = listener;
      return {
        dispose: () => {
          disposed = true;
        },
      };
    },
    set html(value: string) {
      html = value;
      receive?.({ type: 'ready' });
    },
  };
  await provider!.resolveCustomEditor(document, {
    webview,
    onDidDispose: (listener: () => void) => {
      dispose = listener;
    },
  } as unknown as vscode.WebviewPanel);
  expect(html).toContain('id="root"');
  expect(sent).toEqual([{ type: 'update', fileName: 'renamed.JXL', data: document.data }]);
  receive?.({ type: 'unrelated' });
  expect(sent).toHaveLength(1);
  dispose?.();
  expect(disposed).toBe(true);
});
