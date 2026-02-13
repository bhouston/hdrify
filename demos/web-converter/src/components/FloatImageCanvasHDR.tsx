import { convertFloat32ToLinearColorSpace, type FloatImageData, type ToneMappingType } from 'hdrify';
import { useCallback, useEffect, useRef } from 'react';

export interface FloatImageCanvasHDRProps {
  imageData: FloatImageData;
  toneMapping: ToneMappingType;
  exposure: number;
  className?: string;
}

/**
 * Renders HDR image directly to canvas using Float16Array and display-p3.
 * No tone mapping; applies exposure as linear scale.
 * Requires rgba-float16 and display-p3 support (Chrome 135+, Firefox 129+, Safari 18.2+).
 */
export function FloatImageCanvasHDR({
  imageData,
  exposure,
  className,
  toneMapping: _toneMapping,
}: FloatImageCanvasHDRProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const renderToCanvas = useCallback((data: FloatImageData, exp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width, height } = data;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' });
    if (!ctx) return;

    // Convert to linear-p3 if needed (canvas display-p3 expects P3 primaries)
    const srcData = convertFloat32ToLinearColorSpace(data.data, width, height, data.linearColorSpace, 'linear-p3');

    const pixelCount = width * height;
    const f16 = new Float16Array(pixelCount * 4);

    for (let i = 0; i < pixelCount; i++) {
      const si = i * 4;
      const r = (srcData[si] ?? 0) * exp;
      const g = (srcData[si + 1] ?? 0) * exp;
      const b = (srcData[si + 2] ?? 0) * exp;
      const a = srcData[si + 3] ?? 1;

      const rSafe = Number.isFinite(r) ? r : 0;
      const gSafe = Number.isFinite(g) ? g : 0;
      const bSafe = Number.isFinite(b) ? b : 0;
      const aSafe = Number.isFinite(a) ? a : 1;

      const di = i * 4;
      f16[di] = rSafe;
      f16[di + 1] = gSafe;
      f16[di + 2] = bSafe;
      f16[di + 3] = aSafe;
    }

    const imageDataObj = new ImageData(f16, width, height, {
      pixelFormat: 'rgba-float16',
      colorSpace: 'display-p3',
    });
    ctx.putImageData(imageDataObj, 0, 0);
  }, []);

  useEffect(() => {
    renderToCanvas(imageData, exposure);
  }, [imageData, exposure, renderToCanvas]);

  return <canvas className={className} ref={canvasRef} />;
}
