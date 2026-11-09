// Run after `pnpm --filter hdrify-vscode-extension build`.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const htmlBundle = await build({
  entryPoints: [new URL('src/previewHtml.ts', root).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { getPreviewHtml } = await import(
  `data:text/javascript;base64,${Buffer.from(htmlBundle.outputFiles[0].contents).toString('base64')}`
);
const resources = new Map(
  await Promise.all(
    ['preview.js', 'preview.css'].map(async (name) => [`/${name}`, await readFile(new URL(`media/${name}`, root))]),
  ),
);
const server = createServer((request, response) => {
  const resource = resources.get(request.url);
  response.setHeader(
    'Content-Type',
    request.url === '/preview.js' ? 'text/javascript' : request.url === '/preview.css' ? 'text/css' : 'text/html',
  );
  response.end(resource ?? getPreviewHtml('/preview.js', '/preview.css', "'self'"));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    ignoreDefaultArgs: ['--force-color-profile=srgb'],
    args: ['--disable-software-rasterizer'],
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const initial = await readFile(new URL('../../assets/jxl/vardct_float.jxl', root));
  if (process.env.PREVIEW_SDR)
    await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
  await page.addInitScript(() => {
    if (!window.GPUCanvasContext) return;
    // oxlint-disable-next-line typescript/unbound-method -- called below with the original context
    const configure = GPUCanvasContext.prototype.configure;
    GPUCanvasContext.prototype.configure = function (options) {
      window.previewDevice = options.device;
      configure.call(this, options);
    };
  });
  await page.addInitScript((bytes) => {
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        if (message.type === 'ready') {
          window.previewReady = true;
          window.dispatchEvent(
            new MessageEvent('message', {
              data: { type: 'update', fileName: 'vardct_float.jxl', data: Uint8Array.from(bytes).buffer },
            }),
          );
        }
      },
    });
  }, Array.from(initial));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(
    () => window.previewReady && document.querySelector('#status')?.textContent.includes('JPEG XL'),
  );
  const hardware = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    const gl = document.createElement('canvas').getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      hdrDisplay: matchMedia('(dynamic-range: high)').matches,
      adapter: adapter
        ? {
            vendor: adapter.info.vendor,
            description: adapter.info.description,
            fallback: adapter.info.isFallbackAdapter,
          }
        : null,
      renderer: gl?.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    };
  });
  assert.ok(hardware.renderer, 'Require a real GPU renderer');
  assert.doesNotMatch(hardware.renderer, /swiftshader|llvmpipe|lavapipe/i);
  assert.ok(!hardware.adapter?.fallback);
  const results = [{ name: 'immediate ready response', status: await page.locator('#status').textContent() }];
  const mode = await page.locator('canvas').getAttribute('data-display-mode');
  await page.getByRole('button', { name: 'Viewer options', exact: true }).click();
  const mapper = page.getByLabel('Tone mapping', { exact: true });
  assert.equal(await mapper.locator('option[value="none"]').count(), mode === 'hdr' ? 1 : 0);
  assert.equal(await mapper.locator('option[value=""]').count(), 0);
  assert.doesNotMatch(await mapper.textContent(), /Automatic/i);
  assert.equal(await mapper.inputValue(), mode === 'hdr' ? 'none' : 'neutral');
  await mapper.selectOption('agx');
  await page.waitForFunction(() => document.querySelector('canvas')?.dataset.toneMapping === 'agx');
  if (mode === 'hdr') {
    await mapper.selectOption('none');
    await page.waitForFunction(() => document.querySelector('canvas')?.dataset.toneMapping === 'none');
    await page.evaluate(() => window.previewDevice.destroy());
    await page.waitForFunction(
      () =>
        document.querySelector('canvas')?.dataset.displayMode === 'sdr' &&
        document.querySelector('canvas')?.dataset.toneMapping === 'neutral',
    );
    assert.equal(await mapper.inputValue(), 'neutral');
    assert.equal(await mapper.locator('option[value="none"]').count(), 0);
  }
  results.push({
    name: 'capability-dependent tone-mapping controls',
    mode,
    deviceLoss: mode === 'hdr' ? 'None removed; Neutral selected' : 'SDR only',
  });

  const send = async (fileName, bytes) =>
    page.evaluate(
      ({ fileName, bytes }) => {
        window.dispatchEvent(
          new MessageEvent('message', { data: { type: 'update', fileName, data: Uint8Array.from(bytes).buffer } }),
        );
      },
      { fileName, bytes: Array.from(bytes) },
    );
  for (const name of ['lossless_float32.jxl', 'lossless_rgb8_container.jxl', 'features/anim_gif.jxl']) {
    await send(name, await readFile(new URL(`../../assets/jxl/${name}`, root)));
    await page.waitForFunction((name) => {
      const status = document.querySelector('#status');
      return status?.textContent.includes(name) && status.textContent.includes('JPEG XL');
    }, name);
    results.push({ name, status: await page.locator('#status').textContent() });
    if (name.includes('anim_gif')) assert.match(results.at(-1).status, /frames \(showing first\)/);
  }

  for (const reference of ['memorial.jxl', 'memorial_lossy.jxl', 'reference_gradient.jxl', 'reference_cie.jxl']) {
    await send(reference, await readFile(new URL(`../../assets/${reference}`, root)));
    await page.waitForFunction(
      (file) => document.querySelector('#status')?.textContent.startsWith(`${file} ·`),
      reference,
    );
    results.push({ name: reference, status: await page.locator('#status').textContent() });
  }
  await send('broken.jxl', [0xff, 0x0a]);
  await page.waitForSelector('#status.error');
  assert.match(await page.locator('#status').textContent(), /broken.jxl:/);
  // A late/replaced source must recover cleanly, and filenames stay text under CSP.
  const name = '<img src=x onerror=alert(1)>.jxl';
  await send(name, initial);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('JPEG XL'));
  assert.equal(await page.locator('#status img').count(), 0);
  assert.ok(!(await page.locator('#status').getAttribute('class')));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: new URL('dist/preview-browser.png', root).pathname });
  await writeFile(
    new URL('dist/preview-browser-results.json', root),
    JSON.stringify({ hardware, results, malformedAndRecovery: 'passed', pageErrors: errors }, null, 2),
  );
  console.log(JSON.stringify({ hardware, results, malformedAndRecovery: 'passed' }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
