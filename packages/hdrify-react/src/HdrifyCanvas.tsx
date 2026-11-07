import type { HdrifyImage } from 'hdrify';
import type * as React from 'react';
import { useEffect, useRef } from 'react';
import { drawToneMapped } from './capture.js';
import type { DisplayMode, ImageDisplay, ViewerToneMapping } from './display.js';

export interface HdrifyCanvasProps {
  hdrifyImage: HdrifyImage;
  /** Omit to use None on HDR displays and Neutral on SDR displays. */
  toneMapping?: ViewerToneMapping;
  /** Linear exposure multiplier. */
  exposure: number;
  className?: string;
  forwardedRef?: React.RefObject<HTMLCanvasElement | null>;
  /** Called after the current image has finished rendering. */
  onDraw?: (image: HdrifyImage, mode: DisplayMode) => void;
  onError?: (error: Error) => void;
}

const CSS =
  '.hdrify-canvas{display:grid;place-items:center;width:var(--hdrify-image-width);height:auto;aspect-ratio:var(--hdrify-image-aspect);min-height:0;flex:none;margin:auto;min-width:0}.hdrify-canvas>canvas{display:block;dynamic-range-limit:no-limit}';

export function HdrifyCanvas(props: HdrifyCanvasProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latest = useRef(props);
  const redraw = useRef<() => void>(() => {});
  useEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    redraw.current();
  }, [props.hdrifyImage, props.toneMapping, props.exposure]);
  useEffect(() => {
    const forwardedRef = props.forwardedRef;
    if (!forwardedRef) return undefined;
    // oxlint-disable-next-line react/immutability -- forward the active canvas into the caller-owned ref
    forwardedRef.current = canvasRef.current;
    return () => {
      // oxlint-disable-next-line react/immutability -- clear the caller-owned ref on replacement or unmount
      forwardedRef.current = null;
    };
  }, [props.forwardedRef]);

  useEffect(() => {
    const host = hostRef.current!;
    const view = host.ownerDocument.defaultView!;
    const media = view.matchMedia('(dynamic-range: high)');
    let active: ImageDisplay | undefined;
    let canvas: HTMLCanvasElement;
    let disposed = false;
    let generation = 0;
    let drawRevision = 0;
    let fallbackDrawing = '';
    let fallbackImage: HdrifyImage | undefined;
    const mount = (next: HTMLCanvasElement) => {
      canvas = next;
      canvasRef.current = canvas;
      // oxlint-disable-next-line react/immutability -- forwarding the internally created canvas
      if (latest.current.forwardedRef) latest.current.forwardedRef.current = canvas;
      host.replaceChildren(canvas);
    };
    const draw = () => {
      if (disposed || !active) return;
      const display = active;
      const { hdrifyImage: image, toneMapping, exposure, onDraw, onError } = latest.current;
      const mapper = toneMapping ?? (display.mode === 'hdr' ? 'none' : 'neutral');
      const revision = ++drawRevision;
      try {
        const scale = Math.min(
          (host.clientWidth || image.width) / image.width,
          (host.clientHeight || image.height) / image.height,
        );
        const width = Math.max(1, image.width * scale);
        const height = Math.max(1, image.height * scale);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        display.resize(width, height, view.devicePixelRatio || 1);
        display.draw(image, mapper, exposure);
        canvas.dataset.displayMode = display.mode;
        canvas.dataset.toneMapping = mapper;
        void display
          .complete()
          .then(() => {
            if (!disposed && revision === drawRevision && active === display) onDraw?.(image, display.mode);
          })
          .catch((error: unknown) => {
            if (!disposed && active === display) {
              if (display.mode === 'hdr') {
                fallback();
              } else onError?.(error instanceof Error ? error : new Error(String(error)));
            }
          });
      } catch (error) {
        if (display.mode === 'hdr') {
          fallback();
        } else onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const fallback = () => {
      if (disposed) return;
      ++generation;
      active?.dispose();
      mount(host.ownerDocument.createElement('canvas'));
      fallbackImage = undefined;
      fallbackDrawing = '';
      active = {
        mode: 'sdr',
        draw(image, mapper, exposure) {
          const key = `${mapper}:${exposure}`;
          if (fallbackImage === image && fallbackDrawing === key) return;
          drawToneMapped(canvas, image, mapper, exposure);
          fallbackImage = image;
          fallbackDrawing = key;
        },
        resize() {},
        complete: () => Promise.resolve(),
        dispose() {},
      };
      draw();
    };
    const select = async () => {
      const request = ++generation;
      if (!media.matches || !view.navigator.gpu) {
        fallback();
        return;
      }
      let next: ImageDisplay | undefined;
      try {
        const { createWebGPUDisplay } = await import('./webgpuDisplay.js');
        if (disposed || request !== generation) return;
        const candidate = host.ownerDocument.createElement('canvas');
        next = await createWebGPUDisplay(candidate, () => {
          if (!disposed && request === generation) fallback();
        });
        if (disposed || request !== generation) {
          next.dispose();
          return;
        }
        active?.dispose();
        active = next;
        mount(candidate);
        draw();
      } catch {
        next?.dispose();
        if (!disposed && request === generation) fallback();
      }
    };
    redraw.current = draw;
    const observer = new ResizeObserver(draw);
    try {
      observer.observe(host, { box: 'device-pixel-content-box' });
    } catch {
      observer.observe(host);
    }
    const onMediaChange = () => {
      void select();
    };
    media.addEventListener('change', onMediaChange);
    view.addEventListener('resize', draw);
    let resolution = view.matchMedia(`(resolution: ${view.devicePixelRatio}dppx)`);
    const onResolutionChange = () => {
      resolution.removeEventListener('change', onResolutionChange);
      resolution = view.matchMedia(`(resolution: ${view.devicePixelRatio}dppx)`);
      resolution.addEventListener('change', onResolutionChange);
      draw();
    };
    resolution.addEventListener('change', onResolutionChange);
    void select();
    return () => {
      disposed = true;
      ++generation;
      ++drawRevision;
      observer.disconnect();
      media.removeEventListener('change', onMediaChange);
      view.removeEventListener('resize', draw);
      resolution.removeEventListener('change', onResolutionChange);
      active?.dispose();
      canvasRef.current = null;
      redraw.current = () => {};
      host.replaceChildren();
    };
  }, []);

  return (
    <>
      <style>{CSS}</style>
      <div
        ref={hostRef}
        className={`hdrify-canvas${props.className ? ` ${props.className}` : ''}`}
        style={
          {
            '--hdrify-image-width': `${props.hdrifyImage.width}px`,
            '--hdrify-image-aspect': `${props.hdrifyImage.width}/${props.hdrifyImage.height}`,
          } as React.CSSProperties
        }
      />
    </>
  );
}
