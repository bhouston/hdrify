import type { HdrifyImage } from 'hdrify';
import { resolveToneMapping, type DisplayMode, type ViewerToneMapping } from './display.js';
import { type CSSProperties, type Ref, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { captureImage, type ImageViewerCaptureOptions } from './capture.js';
import { decodeHdrifyImage } from './decode.js';
import { HdrifyCanvas } from './HdrifyCanvas.js';
import { type DownloadProgress, type ImageViewerProgress, readResponse } from './progress.js';
import { ViewerReadiness } from './readiness.js';
import { IMAGE_VIEWER_CSS } from './styles.js';

/** `open` shows the options panel, `closed` shows only its gear button, and `hidden` shows neither. */
export type SettingsPanelMode = 'open' | 'closed' | 'hidden';
/** `contain` scales the image to fit the viewer; `actual` shows one image pixel per CSS pixel, scrolling if needed. */
export type ImageFit = 'contain' | 'actual';

/** User-adjustable display settings. */
export interface ImageViewerSettings {
  toneMapping?: ViewerToneMapping;
  /** Exposure in stops (EV): `0` is unchanged, `+1` doubles the brightness. */
  exposure: number;
  fit: ImageFit;
}

export const DEFAULT_IMAGE_VIEWER_SETTINGS: Readonly<ImageViewerSettings> = {
  toneMapping: undefined,
  exposure: 0,
  fit: 'contain',
};

export const TONE_MAPPING_OPTIONS: readonly { value: ViewerToneMapping; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'agx', label: 'AgX' },
  { value: 'aces', label: 'ACES' },
  { value: 'reinhard', label: 'Reinhard' },
];

/** Range of the exposure slider, in stops. The options panel accepts any value. */
export const EXPOSURE_SLIDER_RANGE = { min: -10, max: 10 } as const;

/** Imperative handle for {@link ImageViewer}, received through its `ref` (React 19). */
export interface ImageViewerHandle {
  /**
   * Resolve once the current source is loaded and drawn (immediately with no source). If the source changes first,
   * it waits for the new source instead. Rejects with the load's error, or if the component unmounts.
   */
  whenReady(): Promise<void>;
  /** Wait for {@link whenReady}, then encode the tone-mapped image with the current settings; no viewer controls. */
  toBlob(options?: ImageViewerCaptureOptions): Promise<Blob>;
}

/** Props for {@link ImageViewer}. Settings props override the user's choice whenever they change. */
export interface ImageViewerProps extends Partial<ImageViewerSettings> {
  /** URL of an EXR, HDR, JPEG XL or gain map JPEG (optionally gzipped). Fetching is cancelled when it changes. */
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
  /** Called after each image loads and is drawn. */
  onLoad?: (image: HdrifyImage) => void;
  /** Called with fetch and decode errors; they are also shown in the viewer. */
  onError?: (error: Error) => void;
  /** Called as the image downloads, decodes and is drawn. */
  onProgress?: (progress: ImageViewerProgress) => void;
  /** Called when the user changes a setting with the slider or the options panel. */
  onSettingsChange?: (settings: ImageViewerSettings) => void;
  /** Called when the user opens or closes the options panel. */
  onSettingsPanelChange?: (mode: SettingsPanelMode) => void;
  /** Receives an {@link ImageViewerHandle} for readiness and image capture. */
  ref?: Ref<ImageViewerHandle>;
}

function definedSettings(settings: Partial<ImageViewerSettings>): Partial<ImageViewerSettings> {
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));
}

function formatStops(stops: number): string {
  return `${stops > 0 ? '+' : ''}${Number(stops.toFixed(1))} EV`;
}

/** Wait until the browser has painted, so the progress bar shows before decoding blocks the main thread. */
const afterPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** Share of the progress bar for the download; decoding and drawing take the rest. */
const DOWNLOAD_SHARE = 0.8;
const NO_DOWNLOAD: DownloadProgress = { loaded: 0, total: null, progress: null };
let loadCount = 0;

interface LoadState {
  source?: string | ArrayBuffer | Uint8Array;
  image?: HdrifyImage;
  error?: string;
}

/**
 * Loads and displays an HDR image with tone mapping, a loading bar, an optional options panel and an optional
 * exposure slider. Accepts every format hdrify reads; see {@link decodeHdrifyImage}.
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
  onProgress,
  onSettingsChange,
  onSettingsPanelChange,
  ref,
}: ImageViewerProps) {
  const callbacks = useRef({ onLoad, onError, onProgress, onSettingsChange, onSettingsPanelChange });
  useEffect(() => {
    callbacks.current = { onLoad, onError, onProgress, onSettingsChange, onSettingsPanelChange };
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
    setSettings((current) => ({
      ...current,
      ...definedSettings({ exposure, fit }),
      ...(provided.toneMapping !== toneMapping ? { toneMapping } : {}),
    }));
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

  const [readiness] = useState(() => new ViewerReadiness());
  const [rendered, setRendered] = useState<{
    image: HdrifyImage;
    mode: DisplayMode;
    exposure: number;
    toneMapping?: ViewerToneMapping;
  }>();
  const [renderError, setRenderError] = useState<string>();
  const announced = useRef<HdrifyImage | undefined>(undefined);
  useEffect(() => () => readiness.disconnect(), [readiness]);

  // The latest fetch/decode result, tagged with the source it came from; the rest is derived during render.
  const source = image ? undefined : (data ?? src);
  const [loaded, setLoaded] = useState<LoadState>({});
  // Progress of the current load; `id` remounts the bar so it never animates backwards into a new load.
  const [bar, setBar] = useState<{ id: number; value: number } | null>(null);
  const download = useRef(NO_DOWNLOAD);
  useEffect(() => {
    readiness.pending();
    announced.current = undefined;
    download.current = NO_DOWNLOAD;
    if (image) return; // Drawn below.
    if (!source) {
      readiness.finish();
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const id = ++loadCount;
    let overall = 0;
    const report = (stage: ImageViewerProgress['stage'], totalProgress: number) => {
      if (signal.aborted) return;
      overall = Math.max(overall, totalProgress);
      setBar({ id, value: overall });
      callbacks.current.onProgress?.({ ...download.current, totalProgress: overall, stage });
    };
    const fetchWithProgress = async (url: string) => {
      report('download', 0);
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
      return readResponse(response, signal, (progress) => {
        download.current = progress;
        report('download', DOWNLOAD_SHARE * (progress.progress ?? 0));
      });
    };
    (async () => {
      const bytes = typeof source === 'string' ? await fetchWithProgress(source) : source;
      report('decode', typeof source === 'string' ? DOWNLOAD_SHARE : 0);
      await afterPaint();
      signal.throwIfAborted();
      const decoded = await decodeHdrifyImage(bytes);
      signal.throwIfAborted();
      setLoaded({ source, image: decoded });
    })().catch((reason: unknown) => {
      if (signal.aborted) return;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      readiness.finish(error);
      setBar(null);
      setLoaded({ source, error: error.message });
      callbacks.current.onError?.(error);
    });
    return () => controller.abort();
  }, [image, source, readiness]);
  const loading = source !== undefined && loaded.source !== source;
  // While a new source loads, keep showing the previous image.
  const shownImage = image ?? (source === undefined ? undefined : loaded.image);
  const error = !loading && source !== undefined ? loaded.error : undefined;

  // Readiness follows the asynchronous renderer, including its first completed GPU draw.
  const drawn = loading ? undefined : shownImage;
  const displayMode = rendered?.mode ?? 'sdr';
  const renderReady =
    !!drawn &&
    rendered?.image === drawn &&
    rendered.exposure === settings.exposure &&
    rendered.toneMapping === settings.toneMapping;
  const barValue = bar && !loading && renderReady ? 1 : bar?.value;
  if (!shownImage && rendered) setRendered(undefined);
  const latest = useRef({ image: drawn, settings });
  useEffect(() => {
    latest.current = { image: drawn, settings };
  });
  const handleDraw = (current: HdrifyImage, mode: DisplayMode) => {
    setRenderError(undefined);
    if (mode === 'sdr' && settings.toneMapping === 'none') change({ toneMapping: 'neutral' });
    if (current === drawn)
      setBar((currentBar) => (currentBar && currentBar.value < 1 ? { ...currentBar, value: 1 } : currentBar));
    setRendered((previous) =>
      previous?.image === current &&
      previous.mode === mode &&
      previous.exposure === settings.exposure &&
      previous.toneMapping === settings.toneMapping
        ? previous
        : { image: current, mode, exposure: settings.exposure, toneMapping: settings.toneMapping },
    );
  };
  useEffect(() => {
    if (!drawn || !renderReady || announced.current === drawn) return;
    announced.current = drawn;
    readiness.finish();
    callbacks.current.onProgress?.({ ...download.current, totalProgress: 1, stage: 'render' });
    callbacks.current.onLoad?.(drawn);
  }, [drawn, renderReady, readiness]);

  useImperativeHandle(
    ref,
    () => ({
      whenReady: () => readiness.whenReady(),
      toBlob: async (options) => {
        await readiness.whenReady();
        const { image: current, settings: currentSettings } = latest.current;
        if (!current) throw new Error('No image is loaded.');
        return captureImage(current, currentSettings.toneMapping ?? 'neutral', 2 ** currentSettings.exposure, options);
      },
    }),
    [readiness],
  );

  return (
    <div
      className={className ? `hdrify-viewer ${className}` : 'hdrify-viewer'}
      style={{ height: 480, ...style }}
      data-fit={settings.fit}
      data-display-mode={displayMode}
      aria-busy={loading || (!!drawn && !renderReady)}
    >
      <style>{IMAGE_VIEWER_CSS}</style>
      <div className="hdrify-viewer-viewport">
        {shownImage && (
          <HdrifyCanvas
            hdrifyImage={shownImage}
            toneMapping={settings.toneMapping}
            exposure={2 ** settings.exposure}
            className="hdrify-viewer-canvas"
            onDraw={handleDraw}
            onError={(failure) => {
              readiness.finish(failure);
              setRenderError(failure.message);
              callbacks.current.onError?.(failure);
            }}
          />
        )}
      </div>
      <div className="hdrify-viewer-progress" hidden={barValue === undefined}>
        {/* In <image-viewer>, slot="progress-bar" children replace the default bar, as in <material-viewer>. */}
        <slot name="progress-bar">
          {bar && barValue !== undefined && (
            <div
              key={bar.id}
              className={barValue === 1 ? 'hdrify-viewer-progress-fill complete' : 'hdrify-viewer-progress-fill'}
              part="default-progress-bar"
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a scaled fill, styleable via ::part like <material-viewer>'s
              role="progressbar"
              aria-label="Loading image"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(barValue * 100)}
              aria-hidden={barValue === 1}
              style={{ transform: `scaleX(${Math.max(0.02, barValue)})` }}
            />
          )}
        </slot>
      </div>
      {(error || renderError) && (
        <p role="alert" className="hdrify-viewer-error">
          {error || renderError}
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
          displayMode={displayMode}
          open={panelMode === 'open'}
          onChange={change}
          onOpenChange={(open) => changePanel(open ? 'open' : 'closed')}
        />
      )}
    </div>
  );
}

interface OptionsPanelProps {
  displayMode: DisplayMode;
  settings: ImageViewerSettings;
  image?: HdrifyImage;
  open: boolean;
  onChange: (patch: Partial<ImageViewerSettings>) => void;
  onOpenChange: (open: boolean) => void;
}

function OptionsPanel({ settings, image, displayMode, open, onChange, onOpenChange }: OptionsPanelProps) {
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
            aria-label="Tone mapping"
            value={resolveToneMapping(settings.toneMapping, displayMode)}
            onChange={(event) =>
              onChange({
                toneMapping: event.currentTarget.value ? (event.currentTarget.value as ViewerToneMapping) : undefined,
              })
            }
          >
            {TONE_MAPPING_OPTIONS.filter((option) => option.value !== 'none' || displayMode === 'hdr').map((option) => (
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
