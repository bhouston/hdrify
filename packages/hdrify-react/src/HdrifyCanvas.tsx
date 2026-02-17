import { applyToneMapping, type HdrifyImage, type ToneMappingType } from 'hdrify';
import type * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';

export interface HdrifyCanvasProps {
  hdrifyImage: HdrifyImage;
  toneMapping: ToneMappingType;
  exposure: number;
  className?: string;
  /** Optional ref so parent can access the canvas (e.g. for toBlob). */
  forwardedRef?: React.RefObject<HTMLCanvasElement | null>;
}

export function HdrifyCanvas({
  hdrifyImage,
  toneMapping,
  exposure,
  className,
  forwardedRef,
}: HdrifyCanvasProps): React.ReactElement {
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

  const renderToCanvas = useCallback((data: HdrifyImage, exp: number, tone: ToneMappingType): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width, height } = data;
    canvas.width = width;
    canvas.height = height;
    // LDR from applyToneMapping is sRGB; use srgb canvas so it displays correctly
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' }) ?? canvas.getContext('2d');

    if (!ctx) return;

    const ldrRgb = applyToneMapping(data.data, width, height, {
      toneMapping: tone,
      exposure: exp,
      sourceColorSpace: data.linearColorSpace,
    });

    const canvasImageData = ctx.createImageData(width, height);
    const pixels = canvasImageData.data;
    // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by width * height loop
    const sourceLength = width * height * 3;
    for (let destIndex = 0, sourceIndex = 0; sourceIndex < sourceLength; destIndex += 4, sourceIndex += 3) {
      pixels[destIndex] = ldrRgb[sourceIndex]!;
      pixels[destIndex + 1] = ldrRgb[sourceIndex + 1]!;
      pixels[destIndex + 2] = ldrRgb[sourceIndex + 2]!;
      pixels[destIndex + 3] = 255;
    }
    // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by width * height loop

    ctx.putImageData(canvasImageData, 0, 0);
  }, []);

  useEffect(() => {
    renderToCanvas(hdrifyImage, exposure, toneMapping);
  }, [hdrifyImage, exposure, toneMapping, renderToCanvas]);

  return <canvas className={className} ref={setRef} />;
}
