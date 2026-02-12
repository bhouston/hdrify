import { useEffect, useState } from 'react';

/**
 * Detect support for HDR canvas rendering via ImageData rgba-float16 and display-p3.
 * Chrome 135+, Firefox 129+, Safari 18.2+.
 */
export function useHdrCanvasSupport(): boolean {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    function detect(): boolean {
      if (typeof Float16Array === 'undefined') return false;

      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' });
        if (!ctx) return false;

        const f16 = new Float16Array(4);
        const imageData = new ImageData(f16, 1, 1, {
          pixelFormat: 'rgba-float16',
          colorSpace: 'display-p3',
        });
        ctx.putImageData(imageData, 0, 0);
        return true;
      } catch {
        return false;
      }
    }

    setSupported(detect());
  }, []);

  return supported;
}
