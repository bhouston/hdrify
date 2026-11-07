/** Download progress for the image file. */
export interface DownloadProgress {
  /** Bytes received so far. */
  loaded: number;
  /** File size in bytes, or null when the server does not provide a usable Content-Length. */
  total: number | null;
  /** Fraction from 0 to 1, or null while the file size is unknown. */
  progress: number | null;
}

/** Overall loading progress reported by {@link ImageViewer}'s `onProgress` and `<image-viewer>`'s `progress` event. */
export interface ImageViewerProgress extends DownloadProgress {
  /** Fraction from 0 to 1 across downloading, decoding and drawing. Never moves backwards within a load. */
  totalProgress: number;
  /** The current step: `download`, then `decode`, then `render` (reported once, with `totalProgress` 1). */
  stage: 'download' | 'decode' | 'render';
}

/** Read a response body, reporting immediately, then at most every 100 ms, and on completion. */
export async function readResponse(
  response: Response,
  signal: AbortSignal,
  onProgress: (progress: DownloadProgress) => void,
): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length') ?? NaN);
  // Fetch decodes compressed responses; their Content-Length describes different bytes.
  const encoding = response.headers.get('content-encoding');
  const total = Number.isSafeInteger(length) && length >= 0 && (!encoding || encoding === 'identity') ? length : null;
  let loaded = 0;
  const publish = () => onProgress({ loaded, total, progress: total ? Math.min(loaded / total, 1) : null });
  publish();
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    loaded = bytes.byteLength;
    onProgress({ loaded, total: loaded, progress: 1 });
    return bytes;
  }
  const cancel = () => void reader.cancel().catch(() => {});
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let published = performance.now();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      if (performance.now() - published >= 100) {
        published = performance.now();
        publish();
      }
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    onProgress({ loaded, total: loaded, progress: 1 });
    return bytes;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
