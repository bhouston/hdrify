import type { HdrifyImage, ToneMappingType } from 'hdrify';
import type * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { drawToneMapped } from './capture.js';

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
      canvasRef.current = el;
      if (forwardedRef) {
        // oxlint-disable-next-line react/immutability -- forwarding the element into the parent-owned ref
        forwardedRef.current = el;
      }
    },
    [forwardedRef],
  );

  useEffect(() => {
    if (canvasRef.current) drawToneMapped(canvasRef.current, hdrifyImage, toneMapping, exposure);
  }, [hdrifyImage, exposure, toneMapping]);

  return <canvas className={className} ref={setRef} />;
}
