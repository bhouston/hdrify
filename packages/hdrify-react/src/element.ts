import type { HdrifyImage } from 'hdrify';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { captureImage, type ImageViewerCaptureOptions } from './capture.js';
import {
  DEFAULT_IMAGE_VIEWER_SETTINGS,
  type ImageFit,
  ImageViewer,
  type ImageViewerSettings,
  type SettingsPanelMode,
  TONE_MAPPING_OPTIONS,
} from './ImageViewer.js';
import { ViewerReadiness } from './readiness.js';

const HOST_CSS = ':host{display:block;height:480px;position:relative;min-width:0}:host([hidden]){display:none}';

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((option) => option === value);
}

// Importing this module on an SSR server is safe; registration occurs only in a browser.
// oxlint-disable-next-line typescript/no-extraneous-class
const ElementBase = typeof HTMLElement === 'undefined' ? (class {} as typeof HTMLElement) : HTMLElement;

/**
 * `<image-viewer>`: displays an EXR, HDR or gain map JPEG with tone mapping. A web component wrapping
 * {@link ImageViewer}; it works in plain HTML and any framework.
 *
 * Attributes: `src`, `tone-mapping`, `exposure` (stops), `fit`, `settings-panel`, `exposure-control`.
 * Events: `progress` ({@link ImageViewerProgress}), `load` (`{ image }`), `error` (`{ message, error }`),
 * `settingschange` (`{ settings }`). Children with `slot="progress-bar"` replace the default loading bar.
 */
export class ImageViewerElement extends ElementBase {
  static observedAttributes = ['src', 'tone-mapping', 'exposure', 'fit', 'settings-panel', 'exposure-control'];
  #root?: Root;
  #mount?: HTMLDivElement;
  #generation = 0;
  #reflecting = false;
  #image?: HdrifyImage;
  #data?: ArrayBuffer | Uint8Array;
  #settings: ImageViewerSettings = { ...DEFAULT_IMAGE_VIEWER_SETTINGS };
  #readiness = new ViewerReadiness();
  /** Incremented on every source change, so callbacks from a superseded load are ignored. */
  #revision = 0;
  /** The image currently drawn, for toBlob(). */
  #shown?: HdrifyImage;
  /** The source of the current load: what ImageViewer loads, by precedence. */
  #source?: unknown;

  /** URL to load; reflects the `src` attribute. */
  get src(): string {
    return this.getAttribute('src') ?? '';
  }
  set src(value: string) {
    this.setAttribute('src', value);
  }
  /** A decoded image to display; takes precedence over `data` and `src`. */
  get image(): HdrifyImage | undefined {
    return this.#image;
  }
  set image(value: HdrifyImage | undefined) {
    this.#image = value;
    this.#sourceChanged();
    this.#render();
  }
  /** Encoded EXR, HDR or gain map JPEG bytes; takes precedence over `src`. */
  get data(): ArrayBuffer | Uint8Array | undefined {
    return this.#data;
  }
  set data(value: ArrayBuffer | Uint8Array | undefined) {
    this.#data = value;
    this.#sourceChanged();
    this.#render();
  }
  /** The current display settings. Assign a partial object to change them. */
  get settings(): ImageViewerSettings {
    return { ...this.#settings };
  }
  set settings(patch: Partial<ImageViewerSettings>) {
    const next = { ...this.#settings, ...patch };
    this.#reflect([
      ['tone-mapping', next.toneMapping],
      ['exposure', String(next.exposure)],
      ['fit', next.fit],
    ]);
    this.#settings = next;
    this.#render();
  }

  connectedCallback(): void {
    ++this.#generation;
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = HOST_CSS;
      this.#mount = document.createElement('div');
      this.#mount.style.height = '100%';
      shadow.append(style, this.#mount);
    }
    // A moved element keeps its React root and image; a new root loads the source again.
    if (!this.#root) {
      this.#root = createRoot(this.#mount!);
      this.#sourceChanged(true);
    }
    this.#render();
  }

  /**
   * Resolve once the current source is loaded and drawn (immediately with no source). If the source changes first,
   * it waits for the new source instead. Rejects with the load's error, or if the element is disconnected.
   */
  whenReady(): Promise<void> {
    return this.#readiness.whenReady();
  }

  /**
   * Wait for {@link whenReady}, then encode the tone-mapped image with the current settings, at the image's own
   * size unless `width`/`height` are given. Only the image is included, not the viewer's controls.
   */
  async toBlob(options?: ImageViewerCaptureOptions): Promise<Blob> {
    await this.whenReady();
    if (!this.#shown) throw new Error('No image is loaded.');
    return captureImage(this.#shown, this.#settings.toneMapping, 2 ** this.#settings.exposure, options);
  }

  disconnectedCallback(): void {
    const generation = ++this.#generation;
    // A parent React tree may be removing this element right now: unmount after that commit, and keep the root
    // if the element is moved (disconnected and reconnected synchronously).
    queueMicrotask(() => {
      if (generation !== this.#generation || this.isConnected) return;
      this.#root?.unmount();
      this.#root = undefined;
      this.#readiness.disconnect();
      ++this.#revision;
    });
  }

  attributeChangedCallback(name: string): void {
    if (this.#reflecting) return;
    if (name === 'src') this.#sourceChanged();
    const exposure = this.getAttribute('exposure');
    const toneMapping = oneOf(
      this.getAttribute('tone-mapping'),
      TONE_MAPPING_OPTIONS.map((option) => option.value),
    );
    const fit = oneOf<ImageFit>(this.getAttribute('fit'), ['contain', 'actual']);
    if (toneMapping) this.#settings.toneMapping = toneMapping;
    if (fit) this.#settings.fit = fit;
    if (exposure !== null && Number.isFinite(Number(exposure))) this.#settings.exposure = Number(exposure);
    this.#render();
  }

  // Mark a new load synchronously, so whenReady() called right after a change waits for the new source.
  #sourceChanged(reload = false): void {
    const source = this.#image ?? this.#data ?? this.getAttribute('src') ?? undefined;
    // Setting the same source again does not reload, so it must not start waiting for a load either.
    if (!this.#root || (source === this.#source && !reload)) return;
    this.#source = source;
    ++this.#revision;
    this.#shown = undefined;
    this.#readiness.pending();
    this.setAttribute('aria-busy', String(source !== undefined));
    if (source === undefined) this.#readiness.finish();
  }

  // Write attributes without re-entering attributeChangedCallback.
  #reflect(entries: [string, string][]): void {
    this.#reflecting = true;
    try {
      for (const [name, value] of entries) if (this.getAttribute(name) !== value) this.setAttribute(name, value);
    } finally {
      this.#reflecting = false;
    }
  }

  #dispatch(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #render(): void {
    const exposureControl = this.getAttribute('exposure-control');
    const revision = this.#revision;
    const current = () => revision === this.#revision;
    this.#root?.render(
      createElement(ImageViewer, {
        src: this.getAttribute('src') ?? undefined,
        data: this.#data,
        image: this.#image,
        ...this.#settings,
        settingsPanel: oneOf<SettingsPanelMode>(this.getAttribute('settings-panel'), ['open', 'closed', 'hidden']),
        exposureControl: exposureControl !== null && exposureControl !== 'false',
        style: { height: '100%' },
        onProgress: (progress) => {
          if (!current()) return;
          this.setAttribute('aria-busy', String(progress.totalProgress < 1));
          this.#dispatch('progress', progress);
        },
        onLoad: (image) => {
          if (!current()) return;
          this.#shown = image;
          this.setAttribute('aria-busy', 'false');
          this.#readiness.finish();
          this.#dispatch('load', { image });
        },
        onError: (error) => {
          if (!current()) return;
          this.setAttribute('aria-busy', 'false');
          this.#readiness.finish(error);
          this.#dispatch('error', { message: error.message, error });
        },
        onSettingsChange: (settings) => {
          this.settings = settings;
          this.#dispatch('settingschange', { settings: this.settings });
        },
        onSettingsPanelChange: (mode) => this.#reflect([['settings-panel', mode]]),
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'image-viewer': ImageViewerElement;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('image-viewer'))
  customElements.define('image-viewer', ImageViewerElement);
