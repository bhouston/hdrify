/**
 * Webview preview script - receives HdrifyImage data from extension and renders
 * with applyToneMapping. Bundled with esbuild to include hdrify.
 */

import type { ToneMappingType } from 'hdrify';
import { applyToneMapping } from 'hdrify';

interface PreviewPayload {
  parseError?: string;
  fileName?: string;
  width?: number;
  height?: number;
  linearColorSpace?: string;
  metadata?: Record<string, unknown>;
  fileSize?: number;
  fileExt?: string;
  internalFormat?: string;
  data?: ArrayBuffer;
}

const controlsEl = document.getElementById('controls') as HTMLDivElement;
const metaEl = document.getElementById('meta') as HTMLDivElement;
const canvasEl = document.getElementById('canvas') as HTMLCanvasElement;
const errorEl = document.getElementById('error') as HTMLDivElement;
const tonemapSelect = document.getElementById('tonemap') as HTMLSelectElement;
const exposureSlider = document.getElementById('exposure') as HTMLInputElement;
const exposureVal = document.getElementById('exposureVal') as HTMLSpanElement;

let imageData: {
  width: number;
  height: number;
  data: Float32Array;
  linearColorSpace: string;
} | null = null;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderMeta(payload: PreviewPayload): void {
  if (payload.parseError) return;
  const { width = 0, height = 0, fileSize = 0, internalFormat = '—', fileName = '' } = payload;
  const pixels = width * height;
  metaEl.innerHTML = `
    <dl>
      ${fileName ? `<dt>File name</dt><dd>${escapeHtml(fileName)}</dd>` : ''}
      <dt>Width</dt><dd>${width}</dd>
      <dt>Height</dt><dd>${height}</dd>
      <dt>File size</dt><dd>${formatFileSize(fileSize)}</dd>
      <dt>Pixels</dt><dd>${pixels.toLocaleString()}</dd>
      <dt>Internal format</dt><dd>${escapeHtml(internalFormat)}</dd>
    </dl>
  `;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function render(): void {
  if (!imageData || !canvasEl) return;
  const exposure = parseFloat(exposureSlider?.value ?? '1');
  const toneMapping = (tonemapSelect?.value ?? 'neutral') as ToneMappingType;

  const ldrRgb = applyToneMapping(imageData.data, imageData.width, imageData.height, {
    toneMapping,
    exposure,
    sourceColorSpace: imageData.linearColorSpace as
      | 'linear-rec709'
      | 'linear-srgb'
      | 'linear-display-p3'
      | 'linear-rec2020',
  });

  canvasEl.width = imageData.width;
  canvasEl.height = imageData.height;
  const ctx = canvasEl.getContext('2d', { colorSpace: 'srgb' }) ?? canvasEl.getContext('2d');
  if (!ctx) return;

  const canvasImageData = ctx.createImageData(imageData.width, imageData.height);
  const pixels = canvasImageData.data;
  const sourceLength = imageData.width * imageData.height * 3;
  for (let destIndex = 0, sourceIndex = 0; sourceIndex < sourceLength; destIndex += 4, sourceIndex += 3) {
    pixels[destIndex] = ldrRgb[sourceIndex] ?? 0;
    pixels[destIndex + 1] = ldrRgb[sourceIndex + 1] ?? 0;
    pixels[destIndex + 2] = ldrRgb[sourceIndex + 2] ?? 0;
    pixels[destIndex + 3] = 255;
  }
  ctx.putImageData(canvasImageData, 0, 0);
}

function onMessage(event: MessageEvent<PreviewPayload>): void {
  const payload = event.data;

  if (payload.parseError) {
    errorEl.textContent = payload.parseError;
    errorEl.style.display = 'block';
    controlsEl.style.display = 'none';
    metaEl.innerHTML = payload.fileName ? `<dl><dt>File</dt><dd>${escapeHtml(payload.fileName)}</dd></dl>` : '';
    return;
  }

  errorEl.style.display = 'none';
  controlsEl.style.display = 'flex';
  renderMeta(payload);

  if (!payload.data || payload.width == null || payload.height == null) return;

  const data = new Float32Array(payload.data);
  imageData = {
    width: payload.width,
    height: payload.height,
    data,
    linearColorSpace: payload.linearColorSpace ?? 'linear-rec709',
  };

  render();
}

tonemapSelect?.addEventListener('change', render);
exposureSlider?.addEventListener('input', () => {
  if (exposureVal) exposureVal.textContent = exposureSlider.value;
  render();
});

window.addEventListener('message', onMessage);
