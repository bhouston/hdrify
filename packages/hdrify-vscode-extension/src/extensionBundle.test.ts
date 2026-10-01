import Module, { createRequire } from 'node:module';
import path from 'node:path';
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
