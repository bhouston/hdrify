import { useEffect, useState } from 'react';

/**
 * Detect support for HDR canvas rendering via ImageData rgba-float16 and display-p3.
 * Chrome 135+, Firefox 129+, Safari 18.2+.
 */
export function useHdrCanvasSupport(): boolean {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    function detect(): boolean {
      const isFloat16 = typeof Float16Array !== 'undefined';
      console.log('isFloat16', isFloat16);
      if (!isFloat16) return false;

      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' });
        console.log('isDisplayP3', true);
        if (!ctx) return false;

        const f16 = new Float16Array(4);
        const imageData = new ImageData(f16, 1, 1, {
          pixelFormat: 'rgba-float16',
          colorSpace: 'display-p3',
        });
        ctx.putImageData(imageData, 0, 0);
        console.log('isDisplayP3 with Float16', true);
        return true;
      } catch {
        return false;
      }
    }

    setSupported(detect());
  }, []);

  return supported;
}
