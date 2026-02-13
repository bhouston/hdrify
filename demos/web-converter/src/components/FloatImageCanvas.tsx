import { applyToneMapping, type FloatImageData, type ToneMappingType } from 'hdrify';
import { useCallback, useEffect, useRef } from 'react';

export interface FloatImageCanvasProps {
  imageData: FloatImageData;
  toneMapping: ToneMappingType;
  exposure: number;
  className?: string;
}

export function FloatImageCanvas({ imageData, toneMapping, exposure, className }: FloatImageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    });

    const canvasImageData = ctx.createImageData(width, height);
    const pixels = canvasImageData.data;
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4] = ldrRgb[i * 3] ?? 0;
      pixels[i * 4 + 1] = ldrRgb[i * 3 + 1] ?? 0;
      pixels[i * 4 + 2] = ldrRgb[i * 3 + 2] ?? 0;
      pixels[i * 4 + 3] = 255;
    }

    ctx.putImageData(canvasImageData, 0, 0);
  }, []);

  useEffect(() => {
    renderToCanvas(imageData, exposure, toneMapping);
  }, [imageData, exposure, toneMapping, renderToCanvas]);

  return <canvas className={className} ref={canvasRef} />;
}
