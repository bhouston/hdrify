import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';

const bundle = await build({
  entryPoints: [new URL('../test/browser/viewer.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"development"' },
});
const server = createServer((request, response) => {
  if (request.url === '/delayed.hdr') {
    setTimeout(() => response.end(), 1000);
    return;
  }
  if (request.url === '/viewer.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bundle.outputFiles[0].contents);
  } else
    response.end(
      '<!doctype html><html><body style="margin:0;background:black"><image-viewer style="width:328px;height:164px" settings-panel="open"></image-viewer><script type="module" src="/viewer.js"></script></body></html>',
    );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const results = [];
const configurations = [
  { name: 'chrome', type: chromium, options: { channel: 'chrome' } },
  { name: 'chromium', type: chromium, options: {} },
  { name: 'webkit', type: webkit, options: {} },
  { name: 'firefox', type: firefox, options: {} },
  { name: 'chromium-no-gpu', type: chromium, options: {}, noGpu: true },
  { name: 'chromium-standard-only', type: chromium, options: {}, standardOnly: true },
  { name: 'chromium-sdr-display', type: chromium, options: {}, sdr: true },
];
function captureGpu() {
  window.gpuFrames = [];
  window.textureUploads = [];
  if (!window.GPUCanvasContext || !window.GPUQueue) return;
  // Readback is test instrumentation; production canvases need only RENDER_ATTACHMENT.
  // oxlint-disable-next-line typescript/unbound-method -- the original receiver is restored with .call
  const configure = GPUCanvasContext.prototype.configure;
  GPUCanvasContext.prototype.configure = function (options) {
    configure.call(this, {
      ...options,
      usage: (options.usage ?? GPUTextureUsage.RENDER_ATTACHMENT) | GPUTextureUsage.COPY_SRC,
    });
  };
  // oxlint-disable-next-line typescript/unbound-method -- the original receiver is restored with .call
  const writeTexture = GPUQueue.prototype.writeTexture;
  GPUQueue.prototype.writeTexture = function (destination, data, layout, size) {
    window.textureUploads.push(Array.from(new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2)));
    writeTexture.call(this, destination, data, layout, size);
  };
  // oxlint-disable-next-line typescript/unbound-method -- the original receiver is restored with .call
  const get = GPUCanvasContext.prototype.getCurrentTexture;
  // oxlint-disable-next-line typescript/unbound-method -- the original receiver is restored with .call
  const submit = GPUQueue.prototype.submit;
  let surface;
  GPUCanvasContext.prototype.getCurrentTexture = function () {
    const texture = get.call(this);
    surface = { texture, context: this, configuration: this.getConfiguration() };
    window.lastGpuDevice = surface.configuration.device;
    return texture;
  };
  GPUQueue.prototype.submit = function (commands) {
    submit.call(this, commands);
    if (!surface || surface.configuration?.device.queue !== this) return;
    const { texture, configuration } = surface;
    surface = undefined;
    if (texture.format !== 'rgba16float') return;
    const device = configuration.device;
    const bytesPerRow = Math.ceil((texture.width * 8) / 256) * 256;
    const buffer = device.createBuffer({
      size: bytesPerRow * texture.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width: texture.width, height: texture.height });
    submit.call(this, [encoder.finish()]);
    void buffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const pixels = new Float16Array(buffer.getMappedRange());
        const sample = (x, y) =>
          Array.from(
            pixels.slice(
              (Math.floor(y) * bytesPerRow) / 2 + Math.floor(x) * 4,
              (Math.floor(y) * bytesPerRow) / 2 + Math.floor(x) * 4 + 4,
            ),
          );
        window.gpuFrames.push({
          width: texture.width,
          height: texture.height,
          patches: [0, 1, 2, 3].map((i) => sample(((i + 0.5) * texture.width) / 8, (texture.height * 1.5) / 4)),
          top: sample(texture.width / 16, texture.height / 8),
          bottom: sample(texture.width / 16, (texture.height * 7) / 8),
        });
        buffer.unmap();
        buffer.destroy();
      })
      .catch(() => buffer.destroy());
  };
}
const canvasSelector = 'image-viewer canvas';
async function settle(page) {
  await page.evaluate(async () => {
    const viewer = document.querySelector('image-viewer');
    await viewer.whenReady();
  });
  await page.waitForSelector(canvasSelector);
}
async function change(page, patch) {
  const previous = await page.evaluate(() => window.gpuFrames.length);
  await page.evaluate((settings) => {
    document.querySelector('image-viewer').settings = settings;
  }, patch);
  if ((await page.locator(canvasSelector).getAttribute('data-display-mode')) === 'hdr')
    await page.waitForFunction((count) => window.gpuFrames.length > count, previous);
  else
    await page.waitForFunction(
      (mapper) =>
        document.querySelector('image-viewer').shadowRoot.querySelector('canvas')?.dataset.toneMapping === mapper,
      patch.toneMapping ?? 'neutral',
    );
}
try {
  for (const config of configurations.filter(
    (config) => !process.env.VIEWER_BROWSER || config.name === process.env.VIEWER_BROWSER,
  )) {
    let browser;
    let page;
    const result = { name: config.name };
    try {
      browser = await config.type.launch({
        headless: false,
        ...(config.type === chromium
          ? { ignoreDefaultArgs: ['--force-color-profile=srgb'], args: ['--disable-software-rasterizer'] }
          : {}),
        ...config.options,
      });
      result.version = browser.version();
      page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
      const errors = [];
      result.pageErrors = errors;
      page.on('console', (message) => {
        if (message.type() === 'warning' || message.type() === 'error')
          console.log(config.name, message.type(), message.text());
      });
      page.on('pageerror', (error) => {
        errors.push(String(error));
        console.log(config.name, 'pageerror', String(error));
      });
      await page.addInitScript(captureGpu);
      if (config.noGpu) await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
      if (config.standardOnly)
        await page.addInitScript(() => {
          // oxlint-disable-next-line typescript/unbound-method -- the original receiver is restored with .call
          const configure = GPUCanvasContext.prototype.configure;
          GPUCanvasContext.prototype.configure = function (options) {
            configure.call(this, { ...options, toneMapping: { mode: 'standard' } });
          };
        });
      if (config.sdr)
        await page.addInitScript(() => {
          const match = window.matchMedia.bind(window);
          window.matchMedia = (query) => (query === '(dynamic-range: high)' ? match('(max-width: 0px)') : match(query));
        });
      await page.goto(url);
      await page.waitForFunction(() => !!document.querySelector('image-viewer')?.image);
      await settle(page);
      const state = await page.evaluate(async () => {
        const viewer = document.querySelector('image-viewer');
        const canvas = viewer.shadowRoot.querySelector('canvas');
        const gl = document.createElement('canvas').getContext('webgl2');
        const debug = gl?.getExtension('WEBGL_debug_renderer_info');
        const renderer = gl?.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
        const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
        return {
          mode: canvas.dataset.displayMode,
          mapper: canvas.dataset.toneMapping,
          renderer,
          adapter: adapter ? { vendor: adapter.info.vendor, description: adapter.info.description } : null,
          width: canvas.width,
          height: canvas.height,
        };
      });
      result.initial = state;
      assert.doesNotMatch(state.renderer ?? '', /swiftshader|llvmpipe|lavapipe/i);
      const expectHdr = ['chrome', 'chromium', 'webkit'].includes(config.name);
      assert.equal(state.mode, expectHdr ? 'hdr' : 'sdr');
      assert.equal(state.mapper, expectHdr ? 'none' : 'neutral');
      if (expectHdr) {
        await page.waitForFunction(() => window.gpuFrames.length > 0);
        const frame = await page.evaluate(() => window.gpuFrames.at(-1));
        result.gpu = frame;
        const decode = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
        for (let i = 0; i < 4; i++)
          assert.ok(Math.abs(decode(frame.patches[i][0]) - [0.18, 1, 2, 4][i]) < 0.035, JSON.stringify(frame));
        assert.ok(frame.top[0] > 0.9 && frame.top[2] < 0.01, 'top must be red');
        assert.ok(frame.bottom[2] > 0.9 && frame.bottom[0] < 0.01, 'bottom must be blue');
        const uploads = await page.evaluate(() => window.textureUploads.length);
        await change(page, { exposure: 1 });
        assert.equal(
          await page.evaluate(() => window.textureUploads.length),
          uploads,
          'Exposure-only changes must reuse the texture',
        );
        const bright = await page.evaluate(() => window.gpuFrames.at(-1));
        assert.ok(Math.abs(decode(bright.patches[3][0]) - 8) < 0.08);
      }
      await change(page, { toneMapping: 'reinhard', exposure: 0 });
      assert.equal(await page.locator(canvasSelector).getAttribute('data-tone-mapping'), 'reinhard');
      await change(page, { toneMapping: 'none' });
      assert.equal(await page.locator(canvasSelector).getAttribute('data-tone-mapping'), 'none');
      await page.locator('image-viewer select').first().selectOption('');
      await page.waitForFunction(
        (mapper) =>
          document.querySelector('image-viewer').shadowRoot.querySelector('canvas').dataset.toneMapping === mapper,
        expectHdr ? 'none' : 'neutral',
      );
      await change(page, { toneMapping: 'reinhard' });
      // Removing an explicit attribute restores the automatic default.
      await page.evaluate(() => document.querySelector('image-viewer').removeAttribute('tone-mapping'));
      await page.waitForFunction(
        (mapper) =>
          document.querySelector('image-viewer').shadowRoot.querySelector('canvas').dataset.toneMapping === mapper,
        expectHdr ? 'none' : 'neutral',
      );
      await page.locator('image-viewer').evaluate((viewer) => {
        viewer.style.width = '480px';
        viewer.style.height = '320px';
      });
      if (expectHdr)
        await page.waitForFunction(
          () => document.querySelector('image-viewer').shadowRoot.querySelector('canvas').width === 480,
        );
      await page.waitForFunction(
        () => document.querySelector('image-viewer').shadowRoot.querySelector('canvas').style.width === '480px',
      );
      const resize = await page.locator(canvasSelector).evaluate((canvas) => ({
        width: canvas.width,
        height: canvas.height,
        cssWidth: canvas.style.width,
        cssHeight: canvas.style.height,
      }));
      assert.equal(resize.cssWidth, '480px');
      assert.equal(resize.cssHeight, '240px');
      result.resize = resize;
      if (expectHdr && config.type === chromium) {
        const session = await page.context().newCDPSession(page);
        await session.send('Emulation.setDeviceMetricsOverride', {
          width: 1001,
          height: 700,
          deviceScaleFactor: 2,
          mobile: false,
        });
        await page.waitForFunction(
          () => document.querySelector('image-viewer').shadowRoot.querySelector('canvas').width === 960,
        );
        result.dprChange = 'passed';
      }
      await change(page, { fit: 'actual' });
      await page.waitForFunction(
        () => document.querySelector('image-viewer').shadowRoot.querySelector('canvas').style.width === '8px',
      );
      await page.evaluate(() => {
        document.querySelector('image-viewer').image = {
          width: 4,
          height: 8,
          linearColorSpace: 'linear-rec709',
          data: new Float32Array(4 * 8 * 4).fill(1),
        };
      });
      await settle(page);
      await page.waitForFunction(
        () => document.querySelector('image-viewer').shadowRoot.querySelector('canvas').style.height === '8px',
      );
      assert.equal(
        await page.locator(canvasSelector).getAttribute('data-display-mode'),
        expectHdr ? 'hdr' : 'sdr',
        'Changing image dimensions must preserve the selected renderer',
      );
      const blob = await page.evaluate(async () => {
        const blob = await document.querySelector('image-viewer').toBlob();
        return { type: blob.type, size: blob.size };
      });
      assert.equal(blob.type, 'image/png');
      assert.ok(blob.size > 0);
      if (expectHdr) {
        await page.evaluate(() => {
          const viewer = document.querySelector('image-viewer');
          viewer.style.cssText = 'width:328px;height:164px';
          const data = window.testImage.data.map((value, index) => (index % 4 === 3 ? value : value * 2 ** 20));
          viewer.settings = { fit: 'contain', toneMapping: 'none', exposure: -20 };
          viewer.image = { ...window.testImage, data };
        });
        await settle(page);
        await page.waitForFunction(() => window.gpuFrames.at(-1)?.width >= 328);
        const wide = await page.evaluate(() => window.gpuFrames.at(-1).patches[3][0]);
        assert.ok(
          Math.abs(((wide + 0.055) / 1.055) ** 2.4 - 4) < 0.1,
          'Exposure must recover float32 values above FP16 range',
        );
        await change(page, { exposure: -21 });
        const dimmer = await page.evaluate(() => window.gpuFrames.at(-1).patches[3][0]);
        assert.ok(Math.abs(((dimmer + 0.055) / 1.055) ** 2.4 - 2) < 0.1);
        result.wideFloatSource = 'passed';
        const precision = await page.evaluate(async () => {
          const viewer = document.querySelector('image-viewer');
          const values = [
            -65504,
            -2,
            -0.25,
            -0,
            0,
            2 ** -25,
            2 ** -24,
            2 ** -14,
            1 + 2 ** -11,
            1 + 3 * 2 ** -11,
            0.18,
            65504,
          ];
          const data = new Float32Array(values.length * 4);
          values.forEach((value, i) => data.set([value, value, value, 1], i * 4));
          viewer.settings = { exposure: 0, toneMapping: 'none' };
          viewer.image = { width: values.length, height: 1, data, linearColorSpace: 'linear-rec709' };
          await viewer.whenReady();
          const expected = Array.from(new Uint16Array(new Float16Array(data).buffer));
          return { expected, uploaded: window.textureUploads.at(-1) };
        });
        assert.deepEqual(
          precision.uploaded,
          precision.expected,
          'Uploads must retain signed values and correctly round FP16 boundaries',
        );
        result.fp16Precision = 'passed';
        await page.evaluate(() => document.querySelector('image-viewer').removeAttribute('tone-mapping'));
        await page.evaluate(() => window.lastGpuDevice.destroy());
        await page.waitForFunction(
          () => document.querySelector('image-viewer').shadowRoot.querySelector('canvas').dataset.displayMode === 'sdr',
        );
        assert.equal(await page.locator(canvasSelector).getAttribute('data-tone-mapping'), 'neutral');
        result.deviceLoss = 'fell back to SDR';
      }
      await page.evaluate(() => {
        document.querySelector('image-viewer').image = window.testImage;
      });
      await settle(page);
      await page.evaluate(() => {
        const viewer = document.querySelector('image-viewer');
        viewer.image = undefined;
        viewer.src = '/delayed.hdr';
      });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(async () => {
        const viewer = document.querySelector('image-viewer');
        viewer.image = window.testImage;
        await Promise.race([
          viewer.whenReady(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Reusing an image left readiness pending')), 5000),
          ),
        ]);
      });
      result.reusedImageReadiness = 'passed';
      await page.evaluate(() => {
        const viewer = document.querySelector('image-viewer');
        viewer.remove();
        document.body.append(viewer);
      });
      await settle(page);
      await page.evaluate(() => {
        const viewer = document.querySelector('image-viewer');
        viewer.remove();
      });
      await page.evaluate(() => {
        const viewer = document.createElement('image-viewer');
        viewer.setAttribute('tone-mapping', 'reinhard');
        viewer.style.cssText = 'width:328px;height:164px';
        viewer.image = window.testImage;
        document.body.append(viewer);
      });
      await settle(page);
      assert.equal(
        await page.locator(canvasSelector).getAttribute('data-tone-mapping'),
        'reinhard',
        'An explicit initial mapper must survive renderer selection',
      );
      await page.evaluate(() => document.querySelector('image-viewer').remove());
      await page.evaluate(() => window.mountCanvasHarness());
      await page.waitForFunction(() => window.lowCanvasRef?.current?.dataset.displayMode);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const low = await page.evaluate(() => ({
        mode: window.lowCanvasRef.current.dataset.displayMode,
        height: window.lowCanvasRef.current.parentElement.clientHeight,
        draws: Number(document.querySelector('#canvas-harness').dataset.draws),
      }));
      assert.equal(low.mode, expectHdr ? 'hdr' : 'sdr');
      assert.equal(low.height, 2, 'A max-width constraint must retain the image aspect ratio');
      assert.ok(low.draws >= 1 && low.draws <= 3, 'An onDraw state update must not cause a render loop');
      await page.evaluate(() => window.unmountCanvasHarness());
      assert.deepEqual(errors, []);
      result.status = 'passed';
    } catch (error) {
      result.error = String(error);
      result.failureState = await page
        ?.evaluate(() => {
          const c = document.querySelector('image-viewer')?.shadowRoot?.querySelector('canvas');
          return {
            dpr: devicePixelRatio,
            width: c?.width,
            height: c?.height,
            style: c?.style.cssText,
            dataset: c ? Object.fromEntries(Object.entries(c.dataset)) : null,
            frames: window.gpuFrames.length,
          };
        })
        .catch(() => null);
      result.status = 'failed';
      process.exitCode = 1;
    } finally {
      await browser?.close();
    }
    results.push(result);
    console.log(result.name, result.status, result.error ?? '');
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await mkdir('packages/hdrify-react/dist', { recursive: true });
  await writeFile('packages/hdrify-react/dist/viewer-browser-results.json', JSON.stringify(results, null, 2));
}
