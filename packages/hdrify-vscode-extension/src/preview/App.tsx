import type { HdrifyImage } from 'hdrify';
import { ImageViewer } from 'hdrify-react';
import { useLayoutEffect, useState } from 'react';
import { isPreviewUpdate, type PreviewUpdate } from '../protocol.js';
import { previewStatus } from './status.js';

export function PreviewApp({ api }: { api: { postMessage(message: unknown): void } }) {
  const [update, setUpdate] = useState<PreviewUpdate>();
  const [result, setResult] = useState<{ source: ArrayBuffer; image?: HdrifyImage; error?: string }>();
  useLayoutEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (isPreviewUpdate(event.data)) setUpdate(event.data);
    };
    window.addEventListener('message', receive);
    // Install the listener before the host can send its initial file.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    api.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', receive);
  }, [api]);
  const current = result?.source === update?.data ? result : undefined;
  return (
    <main className="preview-app" aria-label="HDR image preview">
      <ImageViewer
        className="preview-viewer"
        style={{ flex: 1, height: 'auto', minHeight: 0 }}
        data={update?.data}
        exposureControl
        onLoad={(image) => {
          if (update) setResult({ source: update.data, image });
        }}
        onError={(error) => {
          if (update) setResult({ source: update.data, error: error.message });
        }}
      />
      <output id="status" className={current?.error ? 'error' : undefined}>
        {update
          ? current?.error
            ? `${update.fileName}: ${current.error}`
            : current?.image
              ? previewStatus(update.fileName, update.data.byteLength, current.image)
              : `Loading ${update.fileName}…`
          : 'Loading…'}
      </output>
    </main>
  );
}
