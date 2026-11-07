const notConnected = () => settled(Promise.reject(new Error('The viewer is not connected to a document')));

/**
 * Readiness shared by `<image-viewer>` and the React `ImageViewer` (the ies-tools `<light-viewer>` design). The host
 * marks each load with {@link pending} and {@link finish}, and teardown with {@link disconnect}.
 */
export class ViewerReadiness {
  /** Settles when the latest load settles; replaced by every load, so a superseded load never settles a waiter. */
  #ready = notConnected();
  #settle?: (error?: unknown) => void;

  /** Resolve once the latest load has settled, following any newer load that starts while waiting. */
  async whenReady(): Promise<void> {
    let ready: Promise<void>;
    do {
      ready = this.#ready;
      await ready;
    } while (ready !== this.#ready);
  }
  /** Start waiting for a load. A superseded load resolves its promise so waiters move on to the new one. */
  pending(): void {
    let settle!: (error?: unknown) => void;
    const next = new Promise<void>((resolve, reject) => {
      settle = (error) => (error === undefined ? resolve() : reject(error));
    });
    this.#settle?.();
    this.#settle = settle;
    this.#ready = settled(next);
  }
  /** Settle the current load: resolve, or reject with `error`. Without a pending load, mark the viewer ready. */
  finish(error?: unknown): void {
    if (!this.#settle) this.pending();
    this.#settle!(error);
    this.#settle = undefined;
  }
  disconnect(): void {
    this.#settle?.(new Error('The viewer was disconnected'));
    this.#settle = undefined;
    this.#ready = notConnected();
  }
}

/** Mark a stored promise handled, so an unawaited rejection is not reported; awaiting it still rejects. */
function settled(promise: Promise<void>): Promise<void> {
  promise.catch(() => {});
  return promise;
}
