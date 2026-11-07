import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { startPrototypeServer } from './hdr-canvas-prototype.mjs';

const output = resolve(process.env.HDR_RESULTS_DIR ?? 'packages/hdrify-react/dist/hdr-canvas-results');
await mkdir(output, { recursive: true });
const server = await startPrototypeServer();
const results = [];
const browsers = [
  { name: 'chromium', type: chromium, options: {} },
  { name: 'chrome', type: chromium, options: { channel: 'chrome' } },
  { name: 'webkit', type: webkit, options: {} },
  { name: 'firefox', type: firefox, options: {} },
  {
    name: 'chromium-experimental',
    type: chromium,
    options: { args: ['--disable-software-rasterizer', '--enable-experimental-web-platform-features'] },
  },
];

async function checkPixels(page) {
  return page.evaluate(() => {
    const api = window.hdrPrototype;
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- serialized into the browser context
    const decode = (value) => {
      const x = Math.abs(value);
      return Math.sign(value) * (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
    };
    const checks = [];
    for (const surface of api.surfaces) {
      if (!surface.supported) continue;
      const image = {
        width: 6,
        height: 1,
        linearColorSpace: 'linear-rec709',
        data: new Float32Array([0, 0, 0, 1, 0.18, 0.18, 0.18, 1, 0.5, 0.5, 0.5, 1, 1, 1, 1, 1, 2, 2, 2, 1, 4, 4, 4, 1]),
      };
      const original = Array.from(image.data);
      for (const exposureEV of [0, 1, -1]) {
        api.draw(surface, image, exposureEV);
        const read = surface.context.getImageData(0, 0, 6, 1, {
          colorSpace: surface.space,
          pixelFormat: 'rgba-float16',
        });
        const values = Array.from({ length: 6 }, (_, i) =>
          surface.space.endsWith('-linear') ? read.data[i * 4] : decode(read.data[i * 4]),
        );
        const expected = [0, 0.18, 0.5, 1, 2, 4].map((value) => value * 2 ** exposureEV);
        const maxError = Math.max(...values.map((value, i) => Math.abs(value - expected[i])));
        if (maxError > 0.015)
          throw new Error(
            `${surface.space} EV ${exposureEV}: ${JSON.stringify(values)} != ${JSON.stringify(expected)}`,
          );
        checks.push({ space: surface.space, exposureEV, maxError, linearReadback: values });
      }
      if (original.some((value, i) => value !== image.data[i])) throw new Error('Source image mutated');
      // Values are sanitized in destination storage without modifying the source.
      const special = {
        width: 1,
        height: 1,
        linearColorSpace: 'linear-rec709',
        data: new Float32Array([-0.25, Infinity, NaN, 0.5]),
      };
      const pixels = api.preparePixels(special, surface.space, 0);
      if (Array.from(pixels).some((value) => !Number.isFinite(value)) || pixels[0] >= 0 || pixels[3] !== 0.5)
        throw new Error('Invalid signed/finite/alpha handling');
    }
    api.setRamp();
    return checks;
  });
}

async function checkGpu(page) {
  return page.evaluate(async () => {
    const api = window.hdrPrototype;
    if (!api.gpu.supported) return { supported: false, error: api.gpu.error };
    const image = {
      width: 6,
      height: 1,
      linearColorSpace: 'linear-rec709',
      data: new Float32Array([0, 0, 0, 1, 0.18, 0.18, 0.18, 1, 0.5, 0.5, 0.5, 1, 1, 1, 1, 1, 2, 2, 2, 1, 4, 4, 4, 1]),
    };
    const checks = [];
    for (const exposure of [0, 1, -1]) {
      const pixels = await api.gpu.draw(image, exposure, true);
      const encoded = !api.gpu.configuration.colorSpace.endsWith('-linear');
      const values = [0, 1, 2, 3, 4, 5].map((i) => {
        const v = pixels[i * 4];
        return !encoded ? v : v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      const expected = [0, 0.18, 0.5, 1, 2, 4].map((v) => v * 2 ** exposure);
      const maxError = Math.max(...values.map((value, i) => Math.abs(value - expected[i])));
      if (maxError > 0.015) throw new Error(`WebGPU pixel mismatch: ${JSON.stringify(values)}`);
      checks.push({ exposure, linearReadback: values, maxError });
    }
    api.setRamp();
    return { supported: true, checks };
  });
}

async function checkNative(page) {
  return page.evaluate(async () => {
    const api = window.hdrPrototype;
    const imageResults = await api.renderNative();
    for (const [index, image] of Array.from(document.querySelectorAll('#native-surfaces img')).entries()) {
      if (!imageResults[index].decoded) continue;
      const surface =
        api.surfaces.find((candidate) => candidate.supported && candidate.space === 'srgb-linear') ??
        api.surfaces.find((candidate) => candidate.supported && candidate.space === 'srgb');
      if (!surface) continue;
      // This probes a native decoder copied into canvas. It is not a measurement of <img> presentation.
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.configureHighDynamicRange?.({ mode: 'extended' });
      const ctx = canvas.getContext('2d', {
        colorSpace: surface.space,
        colorType: 'float16',
        toneMapping: { mode: 'extended' },
      });
      ctx.drawImage(image, 0, 0);
      const values = [350, 450, 550].map((x) => {
        const v = ctx.getImageData(x, 40, 1, 1, { colorSpace: surface.space, pixelFormat: 'rgba-float16' }).data[0];
        return surface.space.endsWith('-linear') ? v : v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      imageResults[index].canvasDecoderProbe = {
        colorSpace: surface.space,
        extended: ctx.getContextAttributes().toneMapping?.mode === 'extended',
        linearPatches1x2x4x: values,
      };
    }
    return imageResults;
  });
}

async function screenshotInfo(page, bytes) {
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    chunks.push(bytes.toString('ascii', offset + 4, offset + 8));
    offset += 12 + size;
  }
  const screenshotPixels = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    ctx.drawImage(image, 0, 0);
    const values = [];
    const api = window.hdrPrototype;
    const targets = [
      ...api.surfaces,
      { canvas: api.gpu.canvas, supported: api.gpu.supported, space: 'webgpu' },
      ...Array.from(document.querySelectorAll('#native-surfaces img')).map((canvas) => ({
        canvas,
        supported: canvas.complete && canvas.naturalWidth > 0,
        space: canvas.alt,
      })),
    ];
    for (const surface of targets) {
      if (!surface.supported) continue;
      const box = surface.canvas.getBoundingClientRect();
      const pixels = [350, 450, 550].map((x) =>
        Array.from(ctx.getImageData(Math.floor(box.x + x), Math.floor(box.y + 40), 1, 1).data),
      );
      values.push({ space: surface.space, patches1x2x4x: pixels });
    }
    return values;
  }, bytes.toString('base64'));
  return { bitDepth: bytes[24], colorType: bytes[25], chunks, screenshotPixels };
}

try {
  for (const { name, type, options } of browsers) {
    let browser;
    const result = { name };
    try {
      browser = await type.launch({
        headless: false,
        ...(type === chromium
          ? {
              args: ['--disable-software-rasterizer'],
              // Playwright normally forces sRGB, hiding the real display gamut/HDR capability.
              ignoreDefaultArgs: ['--force-color-profile=srgb'],
            }
          : {}),
        ...options,
      });
      result.version = browser.version();
      const page = await browser.newPage({ viewport: { width: 1100, height: 1700 }, deviceScaleFactor: 1 });
      const errors = [];
      result.pageErrors = errors;
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(server.url);
      await page.waitForFunction(() => !!window.hdrPrototype);
      result.capabilities = await page.evaluate(() => window.hdrPrototype.report());
      assert.notEqual(result.capabilities.renderer, 'unavailable', 'Hardware renderer must be identifiable');
      assert.doesNotMatch(result.capabilities.renderer, /swiftshader|llvmpipe|lavapipe/i);
      result.pixelChecks = await checkPixels(page);
      if (type === chromium) assert.ok(result.pixelChecks.length > 0, 'Chromium FP16 upload must work');
      result.gpuChecks = await checkGpu(page);
      result.nativeChecks = await checkNative(page);
      assert.ok(
        result.nativeChecks.find((item) => item.name === 'Gain-map JPEG')?.decoded,
        'Gain-map JPEG base must decode',
      );
      assert.ok(
        result.nativeChecks.find((item) => item.name.startsWith('16-bit PQ PNG'))?.decoded,
        'PQ PNG must decode',
      );
      // Test actual controls: +1 EV must double the linear highlight value.
      await page.locator('#exposure').evaluate((input) => {
        input.value = '1';
        input.dispatchEvent(new Event('input'));
      });
      assert.equal(await page.locator('#ev').textContent(), '1 EV');
      const controls = await page.evaluate(() =>
        window.hdrPrototype.surfaces
          .filter((s) => s.supported)
          .map((s) => {
            const value = s.context.getImageData(550, 40, 1, 1, { colorSpace: s.space, pixelFormat: 'rgba-float16' })
              .data[0];
            return { space: s.space, value };
          }),
      );
      for (const { space, value } of controls)
        assert.ok(Math.abs(value - (space.endsWith('-linear') ? 8 : 1.055 * 8 ** (1 / 2.4) - 0.055)) < 0.015);
      result.exposureControl = 'passed';
      assert.ok(result.gpuChecks.supported || type !== chromium, 'Chromium WebGPU should initialize on this hardware');
      await page.locator('#exposure').evaluate((input) => {
        input.value = '0';
        input.dispatchEvent(new Event('input'));
      });
      const screenshot = await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
      result.screenshot = await screenshotInfo(page, screenshot);
      await page.locator('#sample').click();
      await page.waitForFunction(() => document.querySelector('#reference').width !== 600);
      result.sample = await page.evaluate(() => {
        const canvas = document.querySelector('#reference');
        return { width: canvas.width, height: canvas.height };
      });
      assert.ok(result.sample.width > 0 && result.sample.height > 0);
      assert.deepEqual(errors, []);
      result.status = 'passed';
    } catch (error) {
      result.status = 'failed';
      result.error = String(error);
      process.exitCode = 1;
    } finally {
      await browser?.close();
    }
    results.push(result);
    await writeFile(resolve(output, `${name}.json`), JSON.stringify(result, null, 2));
    console.log(
      `${name} ${result.version ?? ''}: ${result.status}; ${result.pixelChecks?.length ?? 0} FP16/exposure checks; ${result.capabilities?.surfaces.filter((s) => s.extended).length ?? 0} extended surfaces${result.error ? `; ${result.error}` : ''}`,
    );
  }
} finally {
  await server.close();
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`Results: ${output}`);
}
