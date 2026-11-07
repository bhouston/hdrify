import { createGpuSurface } from './webgpu.js';
import { displayNative } from './native-images.js';
import { convertFloat32ToLinearColorSpace } from '../../hdrify/src/color/convert.ts';
import { readHdr } from '../../hdrify/src/hdr/readHdr.ts';
import { applyToneMapping } from '../../hdrify/src/tonemapping/applyToneMapping.ts';

export const spaces = ['display-p3-linear', 'srgb-linear', 'display-p3', 'srgb'];
export const levels = [0, 0.18, 0.5, 1, 2, 4];

// Extended sRGB encoding is sign-preserving and intentionally has no [0,1] clamp.
export function encode(value) {
  const x = Math.abs(value);
  return Math.sign(value) * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
}

export function preparePixels(image, space, exposureEV = 0) {
  const primaries = space.startsWith('display-p3') ? 'linear-p3' : 'linear-rec709';
  const source = image.data.slice();
  for (let i = 0; i < source.length; i++) {
    if (!Number.isFinite(source[i])) source[i] = i % 4 === 3 ? 1 : 0;
  }
  const converted = convertFloat32ToLinearColorSpace(
    source,
    image.width,
    image.height,
    image.linearColorSpace,
    primaries,
  );
  const pixels = new Float16Array(converted.length);
  const linear = space.endsWith('-linear');
  const scale = 2 ** exposureEV;
  for (let i = 0; i < converted.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const value = converted[i + c] * scale;
      // Sanitize only the destination; retain finite signed values for gamut conversion.
      const finite = Number.isFinite(value) ? value : 0;
      pixels[i + c] = Math.max(-65504, Math.min(65504, linear ? finite : encode(finite)));
    }
    const alpha = converted[i + 3];
    pixels[i + 3] = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  }
  return pixels;
}

export function createSurface(space) {
  const canvas = document.createElement('canvas');
  canvas.style.setProperty('dynamic-range-limit', 'no-limit');
  const result = { space, canvas, supported: false, extended: false };
  try {
    // Chromium's experimental presentation API; no flags are enabled by the page.
    if (typeof canvas.configureHighDynamicRange === 'function') canvas.configureHighDynamicRange({ mode: 'extended' });
    const context = canvas.getContext('2d', {
      colorSpace: space,
      colorType: 'float16',
      toneMapping: { mode: 'extended' },
    });
    if (!context) throw new Error('Canvas 2D unavailable');
    result.attributes = context.getContextAttributes();
    result.extended = result.attributes.toneMapping?.mode === 'extended';
    if (result.attributes.colorType !== 'float16') throw new Error('FP16 backing store not acknowledged');
    if (result.attributes.colorSpace !== space) throw new Error('Requested color space not acknowledged');
    const data = new ImageData(new Float16Array([2, 2, 2, 1]), 1, 1, {
      colorSpace: space,
      pixelFormat: 'rgba-float16',
    });
    context.putImageData(data, 0, 0);
    const read = context.getImageData(0, 0, 1, 1, { colorSpace: space, pixelFormat: 'rgba-float16' });
    if (read.pixelFormat !== 'rgba-float16' || Math.abs(read.data[0] - 2) > 0.01)
      throw new Error('FP16 roundtrip failed');
    result.supported = true;
    result.context = context;
  } catch (error) {
    result.error = String(error);
  }
  return result;
}

export function draw(surface, image, exposureEV = 0) {
  if (!surface.supported) return;
  const pixels = preparePixels(image, surface.space, exposureEV);
  surface.canvas.width = image.width;
  surface.canvas.height = image.height;
  surface.context.putImageData(
    new ImageData(pixels, image.width, image.height, {
      colorSpace: surface.space,
      pixelFormat: 'rgba-float16',
    }),
    0,
    0,
  );
}

export function ramp() {
  const width = 600;
  const height = 80;
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data.set([levels[Math.floor(x / 100)], levels[Math.floor(x / 100)], levels[Math.floor(x / 100)], 1], offset);
    }
  return { width, height, data, linearColorSpace: 'linear-rec709' };
}

function diagnostics() {
  const gl = document.createElement('canvas').getContext('webgl2');
  const debug = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = gl ? gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'unavailable';
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  if (/swiftshader|llvmpipe|lavapipe/i.test(renderer)) throw new Error(`Software renderer rejected: ${renderer}`);
  return {
    userAgent: navigator.userAgent,
    renderer,
    hdrDisplay: matchMedia('(dynamic-range: high)').matches,
    p3Display: matchMedia('(color-gamut: p3)').matches,
    float16Array: typeof Float16Array !== 'undefined',
    configureHighDynamicRange: typeof HTMLCanvasElement.prototype.configureHighDynamicRange === 'function',
  };
}

const hardware = diagnostics();
let image = ramp();
const gpu = await createGpuSurface();
if (gpu.supported) document.querySelector('#gpu-surface').append(gpu.canvas);
document.querySelector('#gpu-status').textContent = gpu.supported
  ? `FP16 WebGPU configured; extended presentation ${gpu.extended ? 'acknowledged' : 'not acknowledged'}.`
  : `Unsupported: ${gpu.error}`;
let nativeResults = [];
const surfaces = spaces.map(createSurface);
const reference = document.querySelector('#reference');
const details = document.querySelector('#diagnostics');
for (const surface of surfaces) {
  const card = document.createElement('section');
  const heading = document.createElement('h2');
  heading.textContent = surface.space;
  const status = document.createElement('p');
  status.textContent = surface.supported
    ? surface.extended
      ? 'FP16 + extended presentation configured (display output requires verification).'
      : 'FP16 storage works; extended presentation is not confirmed.'
    : `Unsupported: ${surface.error}`;
  card.append(heading, status);
  if (surface.supported) card.append(surface.canvas);
  surface.canvas.dataset.space = surface.space;
  document.querySelector('#surfaces').append(card);
}

function render() {
  const exposureEV = Number(document.querySelector('#exposure').value);
  document.querySelector('#ev').textContent = `${exposureEV} EV`;
  for (const surface of surfaces) draw(surface, image, exposureEV);
  if (gpu.supported)
    gpu.draw(image, exposureEV).catch((error) => {
      gpu.error = String(error);
      details.textContent = JSON.stringify(report(), null, 2);
    });
  reference.width = image.width;
  reference.height = image.height;
  const context = reference.getContext('2d', { colorSpace: 'srgb' });
  const rgb = applyToneMapping(image.data.slice(), image.width, image.height, {
    toneMapping: 'neutral',
    exposure: 2 ** exposureEV,
    sourceColorSpace: image.linearColorSpace,
  });
  const rgba = context.createImageData(image.width, image.height);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) rgba.data.set([rgb[i], rgb[i + 1], rgb[i + 2], 255], j);
  context.putImageData(rgba, 0, 0);
  details.textContent = JSON.stringify(report(), null, 2);
}

function report() {
  return {
    ...hardware,
    webgpu: {
      supported: gpu.supported,
      extended: gpu.extended,
      adapter: gpu.adapter,
      configuration: gpu.configuration,
      error: gpu.error,
    },
    native: nativeResults.map(({ name, bytes, decoded, width, height, error }) => ({
      name,
      bytes,
      decoded,
      width,
      height,
      error,
    })),
    surfaces: surfaces.map(({ space, supported, extended, attributes, error }) => ({
      space,
      supported,
      extended,
      attributes,
      error,
    })),
  };
}

async function loadSample() {
  image = readHdr(new Uint8Array(await (await fetch('/sample.hdr')).arrayBuffer()));
  render();
  return { width: image.width, height: image.height };
}

document.querySelector('#exposure').addEventListener('input', render);
document.querySelector('#ramp').addEventListener('click', () => {
  image = ramp();
  render();
});
document.querySelector('#sample').addEventListener('click', () =>
  loadSample().catch((error) => {
    details.textContent = String(error);
  }),
);
async function renderNative() {
  const container = document.querySelector('#native-surfaces');
  container.replaceChildren();
  nativeResults = await displayNative(image, Number(document.querySelector('#exposure').value), container);
  details.textContent = JSON.stringify(report(), null, 2);
  return nativeResults.map(({ name, bytes, decoded, width, height, error }) => ({
    name,
    bytes,
    decoded,
    width,
    height,
    error,
  }));
}
document.querySelector('#transcode').addEventListener('click', () =>
  renderNative().catch((error) => {
    details.textContent = String(error);
  }),
);
window.hdrPrototype = {
  gpu,
  renderNative,
  report,
  surfaces,
  draw,
  preparePixels,
  ramp,
  loadSample,
  render,
  setRamp() {
    image = ramp();
    render();
  },
};
render();
