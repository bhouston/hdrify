import { describe, expect, it } from 'vitest';
import { captureSize } from './capture.js';
import { type DownloadProgress, readResponse } from './progress.js';
import { ViewerReadiness } from './readiness.js';

const streamed = (chunks: number[], headers: Record<string, string>) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const size of chunks) controller.enqueue(new Uint8Array(size).fill(7));
        controller.close();
      },
    }),
    { headers },
  );

describe('readResponse', () => {
  it('reports from 0 to 1 against Content-Length and returns every byte', async () => {
    const reports: DownloadProgress[] = [];
    const bytes = await readResponse(streamed([3, 5], { 'content-length': '8' }), new AbortController().signal, (p) =>
      reports.push(p),
    );
    expect(bytes).toEqual(new Uint8Array(8).fill(7));
    expect(reports[0]).toEqual({ loaded: 0, total: 8, progress: 0 });
    expect(reports.at(-1)).toEqual({ loaded: 8, total: 8, progress: 1 });
  });

  it('treats the size as unknown for compressed responses', async () => {
    const reports: DownloadProgress[] = [];
    await readResponse(
      streamed([4], { 'content-length': '2', 'content-encoding': 'gzip' }),
      new AbortController().signal,
      (p) => reports.push(p),
    );
    expect(reports[0]).toEqual({ loaded: 0, total: null, progress: null });
    expect(reports.at(-1)).toEqual({ loaded: 4, total: 4, progress: 1 });
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readResponse(streamed([4], {}), controller.signal, () => {})).rejects.toThrow();
  });
});

describe('ViewerReadiness', () => {
  it('rejects before the first load and after disconnect', async () => {
    const readiness = new ViewerReadiness();
    await expect(readiness.whenReady()).rejects.toThrow(/not connected/);
    readiness.finish();
    await expect(readiness.whenReady()).resolves.toBeUndefined();
    readiness.disconnect();
    await expect(readiness.whenReady()).rejects.toThrow(/not connected/);
  });

  it('waits for a newer load that starts while waiting, and reports its error', async () => {
    const readiness = new ViewerReadiness();
    readiness.pending();
    const waiting = readiness.whenReady();
    readiness.pending(); // Supersedes the first load.
    readiness.finish(new Error('bad file'));
    await expect(waiting).rejects.toThrow('bad file');
  });
});

describe('captureSize', () => {
  it('keeps the aspect ratio when one dimension is given', () => {
    expect(captureSize({}, 400, 200)).toEqual({ width: 400, height: 200 });
    expect(captureSize({ width: 100 }, 400, 200)).toEqual({ width: 100, height: 50 });
    expect(captureSize({ height: 100 }, 400, 200)).toEqual({ width: 200, height: 100 });
    expect(() => captureSize({ width: 0 }, 400, 200)).toThrow(RangeError);
  });
});
