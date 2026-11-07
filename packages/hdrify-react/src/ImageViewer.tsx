import type { HdrifyImage, ToneMappingType } from 'hdrify';
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { decodeHdrifyImage } from './decode.js';
import { HdrifyCanvas } from './HdrifyCanvas.js';
import { IMAGE_VIEWER_CSS } from './styles.js';

/** `open` shows the options panel, `closed` shows only its gear button, and `hidden` shows neither. */
export type SettingsPanelMode = 'open' | 'closed' | 'hidden';
/** `contain` scales the image to fit the viewer; `actual` shows one image pixel per CSS pixel, scrolling if needed. */
export type ImageFit = 'contain' | 'actual';

/** User-adjustable display settings. */
export interface ImageViewerSettings {
  toneMapping: ToneMappingType;
  /** Exposure in stops (EV): `0` is unchanged, `+1` doubles the brightness. */
  exposure: number;
  fit: ImageFit;
}

export const DEFAULT_IMAGE_VIEWER_SETTINGS: Readonly<ImageViewerSettings> = {
  toneMapping: 'neutral',
  exposure: 0,
  fit: 'contain',
};

export const TONE_MAPPING_OPTIONS: readonly { value: ToneMappingType; label: string }[] = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'agx', label: 'AgX' },
  { value: 'aces', label: 'ACES' },
  { value: 'reinhard', label: 'Reinhard' },
];

/** Range of the exposure slider, in stops. The options panel accepts any value. */
export const EXPOSURE_SLIDER_RANGE = { min: -10, max: 10 } as const;

/** Props for {@link ImageViewer}. Settings props override the user's choice whenever they change. */
export interface ImageViewerProps extends Partial<ImageViewerSettings> {
  /** URL of an EXR, HDR or gain map JPEG (optionally gzipped). Fetching is cancelled when it changes. */
  src?: string;
  /** Encoded file bytes; takes precedence over `src`. */
  data?: ArrayBuffer | Uint8Array;
  /** An already decoded image; takes precedence over `data` and `src`. */
  image?: HdrifyImage;
  /** Initial state of the options panel. Defaults to `closed`. */
  settingsPanel?: SettingsPanelMode;
  /** Show the vertical exposure slider over the left edge. */
  exposureControl?: boolean;
  /** Wrapper class name. */
  className?: string;
  /** Wrapper style; the default height is 480 pixels. */
  style?: CSSProperties;
  /** Called after each image loads. */
  onLoad?: (image: HdrifyImage) => void;
  /** Called with fetch and decode errors; they are also shown in the viewer. */
  onError?: (error: Error) => void;
  /** Called when the user changes a setting with the slider or the options panel. */
  onSettingsChange?: (settings: ImageViewerSettings) => void;
  /** Called when the user opens or closes the options panel. */
  onSettingsPanelChange?: (mode: SettingsPanelMode) => void;
}

function definedSettings(settings: Partial<ImageViewerSettings>): Partial<ImageViewerSettings> {
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));
}

function formatStops(stops: number): string {
  return `${stops > 0 ? '+' : ''}${Number(stops.toFixed(1))} EV`;
}

async function fetchBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

interface LoadState {
  source?: string | ArrayBuffer | Uint8Array;
  image?: HdrifyImage;
  error?: string;
}

/**
 * Loads and displays an HDR image with tone mapping, an optional options panel and an optional exposure slider.
 * Accepts every format hdrify reads; see {@link decodeHdrifyImage}.
 *
 * @example
 * ```tsx
 * <ImageViewer src="/images/memorial.exr" exposureControl toneMapping="agx" style={{ height: 600 }} />
 * ```
 */
export function ImageViewer({
  src,
  data,
  image,
  toneMapping,
  exposure,
  fit,
  settingsPanel = 'closed',
  exposureControl = false,
  className,
  style,
  onLoad,
  onError,
  onSettingsChange,
  onSettingsPanelChange,
}: ImageViewerProps) {
  const callbacks = useRef({ onLoad, onError, onSettingsChange, onSettingsPanelChange });
  useEffect(() => {
    callbacks.current = { onLoad, onError, onSettingsChange, onSettingsPanelChange };
  });

  // Props seed the state and override it whenever they change; the user can change it in between.
  const [settings, setSettings] = useState<ImageViewerSettings>(() => ({
    ...DEFAULT_IMAGE_VIEWER_SETTINGS,
    ...definedSettings({ toneMapping, exposure, fit }),
  }));
  const [provided, setProvided] = useState({ toneMapping, exposure, fit, settingsPanel });
  const [panelMode, setPanelMode] = useState<SettingsPanelMode>(settingsPanel);
  if (
    provided.toneMapping !== toneMapping ||
    provided.exposure !== exposure ||
    provided.fit !== fit ||
    provided.settingsPanel !== settingsPanel
  ) {
    setProvided({ toneMapping, exposure, fit, settingsPanel });
    setSettings((current) => ({ ...current, ...definedSettings({ toneMapping, exposure, fit }) }));
    if (provided.settingsPanel !== settingsPanel) setPanelMode(settingsPanel);
  }

  const change = (patch: Partial<ImageViewerSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    callbacks.current.onSettingsChange?.(next);
  };
  const changePanel = (mode: SettingsPanelMode) => {
    setPanelMode(mode);
    callbacks.current.onSettingsPanelChange?.(mode);
  };

  // The latest fetch/decode result, tagged with the source it came from; the rest is derived during render.
  const source = image ? undefined : (data ?? src);
  const [loaded, setLoaded] = useState<LoadState>({});
  useEffect(() => {
    if (image) {
      callbacks.current.onLoad?.(image);
      return;
    }
    if (!source) return;
    const controller = new AbortController();
    (async () => {
      const decoded = await decodeHdrifyImage(
        typeof source === 'string' ? await fetchBytes(source, controller.signal) : source,
      );
      if (controller.signal.aborted) return;
      setLoaded({ source, image: decoded });
      callbacks.current.onLoad?.(decoded);
    })().catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      setLoaded({ source, error: error.message });
      callbacks.current.onError?.(error);
    });
    return () => controller.abort();
  }, [image, source]);
  const loading = source !== undefined && loaded.source !== source;
  // While a new source loads, keep showing the previous image.
  const shownImage = image ?? (source === undefined ? undefined : loaded.image);
  const error = !loading && source !== undefined ? loaded.error : undefined;

  return (
    <div
      className={className ? `hdrify-viewer ${className}` : 'hdrify-viewer'}
      style={{ height: 480, ...style }}
      data-fit={settings.fit}
    >
      <style>{IMAGE_VIEWER_CSS}</style>
      <div className="hdrify-viewer-viewport">
        {shownImage && (
          <HdrifyCanvas
            hdrifyImage={shownImage}
            toneMapping={settings.toneMapping}
            exposure={2 ** settings.exposure}
            className="hdrify-viewer-canvas"
          />
        )}
      </div>
      {loading && <output className="hdrify-viewer-status">Loading image…</output>}
      {error && (
        <p role="alert" className="hdrify-viewer-error">
          {error}
        </p>
      )}
      {exposureControl && (
        <div className="hdrify-viewer-exposure hdrify-viewer-surface" title="Exposure (double-click to reset)">
          <output>{formatStops(settings.exposure)}</output>
          <input
            type="range"
            aria-label="Exposure in stops"
            min={EXPOSURE_SLIDER_RANGE.min}
            max={EXPOSURE_SLIDER_RANGE.max}
            step={0.1}
            value={settings.exposure}
            onChange={(event) => change({ exposure: event.currentTarget.valueAsNumber })}
            onDoubleClick={() => change({ exposure: 0 })}
          />
        </div>
      )}
      {panelMode !== 'hidden' && (
        <OptionsPanel
          settings={settings}
          image={shownImage}
          open={panelMode === 'open'}
          onChange={change}
          onOpenChange={(open) => changePanel(open ? 'open' : 'closed')}
        />
      )}
    </div>
  );
}

interface OptionsPanelProps {
  settings: ImageViewerSettings;
  image?: HdrifyImage;
  open: boolean;
  onChange: (patch: Partial<ImageViewerSettings>) => void;
  onOpenChange: (open: boolean) => void;
}

function OptionsPanel({ settings, image, open, onChange, onOpenChange }: OptionsPanelProps) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const close = useRef(() => onOpenChange(false));
  useEffect(() => {
    close.current = () => onOpenChange(false);
  });
  // Close on Escape or a pointer press outside; composedPath sees through the element's shadow root.
  useEffect(() => {
    const document = button.current?.ownerDocument;
    if (!open || !document) return;
    const outside = (event: Event) => {
      const path = event.composedPath();
      if (!path.includes(panel.current!) && !path.includes(button.current!)) close.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close.current();
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="hdrify-viewer-toggle hdrify-viewer-surface"
        aria-label="Viewer options"
        title="Viewer options"
        aria-controls={id}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path
            d="m9 3-.8 2.2-2 .9L4 5.5 2.5 8l1.6 1.7-.2 2.3L2 13.5 3.5 16l2.3-.4 1.8 1.4.4 2.4h3l.8-2.2 2-.9 2.2.6 1.5-2.5-1.6-1.7.2-2.3L18 8.5 16.5 6l-2.3.4-1.8-1.4L12 3Z"
            transform="translate(2 1)"
          />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      <section
        ref={panel}
        id={id}
        className="hdrify-viewer-panel hdrify-viewer-surface"
        aria-label="Viewer options"
        hidden={!open}
      >
        <header>
          <strong>Viewer options</strong>
          <button type="button" aria-label="Close viewer options" onClick={() => onOpenChange(false)}>
            ×
          </button>
        </header>
        <label>
          Tone mapping
          <select
            value={settings.toneMapping}
            onChange={(event) => onChange({ toneMapping: event.currentTarget.value as ToneMappingType })}
          >
            {TONE_MAPPING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Exposure (EV)
          <input
            type="number"
            step={0.1}
            value={Number(settings.exposure.toFixed(2))}
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isFinite(value)) onChange({ exposure: value });
            }}
          />
        </label>
        <label>
          Size
          <select value={settings.fit} onChange={(event) => onChange({ fit: event.currentTarget.value as ImageFit })}>
            <option value="contain">Fit to view</option>
            <option value="actual">Actual size</option>
          </select>
        </label>
        {image && (
          <dl>
            <dt>Dimensions</dt>
            <dd>
              {image.width} × {image.height}
            </dd>
            <dt>Color space</dt>
            <dd>{image.linearColorSpace}</dd>
            {typeof image.metadata?.format === 'string' && (
              <>
                <dt>Format</dt>
                <dd>{image.metadata.format}</dd>
              </>
            )}
          </dl>
        )}
      </section>
    </>
  );
}
