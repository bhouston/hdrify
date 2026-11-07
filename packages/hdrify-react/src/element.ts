import type { HdrifyImage } from 'hdrify';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  DEFAULT_IMAGE_VIEWER_SETTINGS,
  type ImageFit,
  ImageViewer,
  type ImageViewerSettings,
  type SettingsPanelMode,
  TONE_MAPPING_OPTIONS,
} from './ImageViewer.js';

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
 * Events: `load` (`{ image }`), `error` (`{ message, error }`), `settingschange` (`{ settings }`).
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

  /** A decoded image to display; takes precedence over `data` and `src`. */
  get image(): HdrifyImage | undefined {
    return this.#image;
  }
  set image(value: HdrifyImage | undefined) {
    this.#image = value;
    this.#render();
  }
  /** Encoded EXR, HDR or gain map JPEG bytes; takes precedence over `src`. */
  get data(): ArrayBuffer | Uint8Array | undefined {
    return this.#data;
  }
  set data(value: ArrayBuffer | Uint8Array | undefined) {
    this.#data = value;
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
    this.#root ??= createRoot(this.#mount!);
    this.#render();
  }

  disconnectedCallback(): void {
    const generation = ++this.#generation;
    // A parent React tree may be removing this element right now: unmount after that commit, and keep the root
    // if the element is moved (disconnected and reconnected synchronously).
    queueMicrotask(() => {
      if (generation !== this.#generation || this.isConnected) return;
      this.#root?.unmount();
      this.#root = undefined;
    });
  }

  attributeChangedCallback(): void {
    if (this.#reflecting) return;
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
    this.#root?.render(
      createElement(ImageViewer, {
        src: this.getAttribute('src') ?? undefined,
        data: this.#data,
        image: this.#image,
        ...this.#settings,
        settingsPanel: oneOf<SettingsPanelMode>(this.getAttribute('settings-panel'), ['open', 'closed', 'hidden']),
        exposureControl: exposureControl !== null && exposureControl !== 'false',
        style: { height: '100%' },
        onLoad: (image) => this.#dispatch('load', { image }),
        onError: (error) => this.#dispatch('error', { message: error.message, error }),
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
