/**
 * Webview preview script: receives decoded HdrifyImage data from the extension host and shows it in the shared
 * <image-viewer> element from hdrify-react. Bundled with esbuild (React, react-dom and hdrify included).
 */

import 'hdrify-react/element';
import type { LinearColorSpace } from 'hdrify';

interface PreviewPayload {
  parseError?: string;
  fileName?: string;
  width?: number;
  height?: number;
  linearColorSpace?: LinearColorSpace;
  metadata?: Record<string, unknown>;
  fileSize?: number;
  internalFormat?: string;
  data?: ArrayBuffer;
}

const viewer = document.querySelector('image-viewer')!;
const statusEl = document.getElementById('status')!;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

window.addEventListener('message', (event: MessageEvent<PreviewPayload>) => {
  const { parseError, fileName = '', width, height, fileSize = 0, internalFormat, data } = event.data;
  if (parseError) {
    viewer.hidden = true;
    statusEl.textContent = `${fileName}: ${parseError}`;
    statusEl.classList.add('error');
    return;
  }
  if (!data || width == null || height == null) return;
  viewer.hidden = false;
  statusEl.classList.remove('error');
  statusEl.textContent = [
    fileName,
    `${width} × ${height}`,
    `${(width * height).toLocaleString()} pixels`,
    formatFileSize(fileSize),
    internalFormat && internalFormat !== '—' ? internalFormat : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  viewer.image = {
    width,
    height,
    data: new Float32Array(data),
    linearColorSpace: event.data.linearColorSpace ?? 'linear-rec709',
    metadata: event.data.metadata,
  };
});

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
// oxlint-disable-next-line unicorn/require-post-message-target-origin
acquireVsCodeApi().postMessage({ type: 'ready' });
