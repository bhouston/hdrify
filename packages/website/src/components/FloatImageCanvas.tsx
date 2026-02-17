import { applyToneMapping, type FloatImageData, type ToneMappingType } from 'hdrify';
import type * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';

export interface FloatImageCanvasProps {
  imageData: FloatImageData;
  toneMapping: ToneMappingType;
  exposure: number;
  className?: string;
  /** Optional ref so parent can access the canvas (e.g. for toBlob). */
  forwardedRef?: React.RefObject<HTMLCanvasElement | null>;
}

export function FloatImageCanvas({ imageData, toneMapping, exposure, className, forwardedRef }: FloatImageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const setRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = el;
      if (forwardedRef) {
        (forwardedRef as React.MutableRefObject<HTMLCanvasElement | null>).current = el;
      }
    },
    [forwardedRef],
  );

  const renderToCanvas = useCallback((data: FloatImageData, exp: number, tone: ToneMappingType) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width, height } = data;
    canvas.width = width;
    canvas.height = height;
    // LDR from applyToneMapping is sRGB; use srgb canvas so it displays correctly
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' }) ?? canvas.getContext('2d');

    if (!ctx) return false;
    if (!ctx) return;

    const ldrRgb = applyToneMapping(data.data, width, height, {
      toneMapping: tone,
      exposure: exp,
      sourceColorSpace: data.linearColorSpace,
    });

    const canvasImageData = ctx.createImageData(width, height);
    const pixels = canvasImageData.data;
    // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by width * height loop
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4] = ldrRgb[i * 3]!;
      pixels[i * 4 + 1] = ldrRgb[i * 3 + 1]!;
      pixels[i * 4 + 2] = ldrRgb[i * 3 + 2]!;
      pixels[i * 4 + 3] = 255;
    }
    // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by width * height loop

    ctx.putImageData(canvasImageData, 0, 0);
  }, []);

  useEffect(() => {
    renderToCanvas(imageData, exposure, toneMapping);
  }, [imageData, exposure, toneMapping, renderToCanvas]);

  return <canvas className={className} ref={setRef} />;
}
