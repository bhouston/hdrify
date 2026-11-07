import useBaseUrl from '@docusaurus/useBaseUrl';
import { createElement, type CSSProperties, useEffect } from 'react';

// scripts/copy-viewer.mjs copies the workspace's standalone bundle to static/viewer. Load it with a module script
// rather than through webpack, so the page runs exactly the file that is published for CDN use.
export default function LiveImageViewer({
  src = '/viewer/memorial.exr',
  style,
  ...attributes
}: { src?: string; style?: CSSProperties } & Record<string, string>) {
  const url = useBaseUrl(src);
  const bundleUrl = useBaseUrl('/viewer/image-viewer.js');
  useEffect(() => {
    if (customElements.get('image-viewer') || document.querySelector(`script[src="${bundleUrl}"]`)) return;
    const script = document.createElement('script');
    script.type = 'module';
    script.src = bundleUrl;
    document.head.append(script);
  }, [bundleUrl]);
  return createElement('image-viewer', { src: url, style: { display: 'block', height: 480, ...style }, ...attributes });
}
