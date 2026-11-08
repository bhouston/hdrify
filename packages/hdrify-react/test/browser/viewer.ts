import { ImageViewerElement } from '../../src/element.js';
if (!customElements.get('image-viewer')) customElements.define('image-viewer', ImageViewerElement);

const image = { width: 8, height: 4, linearColorSpace: 'linear-rec709' as const, data: new Float32Array(8 * 4 * 4) };
for (let y = 0; y < 4; y++)
  for (let x = 0; x < 8; x++) {
    const v = [0.18, 1, 2, 4][x % 4];
    image.data.set(y === 0 ? [1, 0, 0, 1] : y === 3 ? [0, 0, 1, 1] : [v, v, v, 1], (y * 8 + x) * 4);
  }
const viewer = document.querySelector('image-viewer')!;
viewer.image = image;
Object.assign(window, { testImage: image });

import { createElement, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HdrifyCanvas } from '../../src/HdrifyCanvas.js';

Object.assign(window, {
  mountCanvasHarness() {
    const style = document.createElement('style');
    style.textContent = '.test-constrained-canvas{max-width:4px}';
    document.head.append(style);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const forwardedRef = { current: null as HTMLCanvasElement | null };
    Object.assign(window, { lowCanvasRef: forwardedRef });
    function Harness() {
      const [draws, setDraws] = useState(0);
      return createElement(
        'div',
        { id: 'canvas-harness', 'data-draws': draws },
        createElement(HdrifyCanvas, {
          className: 'test-constrained-canvas',
          hdrifyImage: image,
          exposure: 1,
          forwardedRef,
          onDraw: () => setDraws((current) => current + 1),
        }),
      );
    }
    root.render(createElement(StrictMode, null, createElement(Harness)));
    Object.assign(window, {
      unmountCanvasHarness() {
        root.unmount();
        host.remove();
        style.remove();
      },
    });
  },
});
