/**
 * Styles for {@link ImageViewer}, rendered inline by the component so it needs no CSS loader. Re-theme it by setting
 * `--hdrify-viewer-*` custom properties on the viewer or an ancestor; they inherit into the element's shadow root.
 */
export const IMAGE_VIEWER_CSS = `
.hdrify-viewer {
  --hv-bg: var(--hdrify-viewer-background, #000);
  --hv-fg: var(--hdrify-viewer-foreground, #e5e7eb);
  --hv-muted: var(--hdrify-viewer-muted-foreground, #a3adba);
  --hv-popover: var(--hdrify-viewer-popover, rgb(17 24 32 / 92%));
  --hv-border: var(--hdrify-viewer-border, #49515e);
  --hv-input: var(--hdrify-viewer-input, #20252e);
  --hv-primary: var(--hdrify-viewer-primary, #7dd3fc);
  --hv-ring: var(--hdrify-viewer-ring, #7dd3fc);
  --hv-error: var(--hdrify-viewer-destructive, #f87171);
  --hv-radius: var(--hdrify-viewer-radius, 6px);
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
  min-width: 0;
  background: var(--hv-bg);
  color: var(--hv-fg);
  font: var(--hdrify-viewer-font-size, var(--vscode-font-size, 13px)) / 1.4
    var(--hdrify-viewer-font-family, var(--vscode-font-family, system-ui, sans-serif));
}
.hdrify-viewer *, .hdrify-viewer *::before, .hdrify-viewer *::after { box-sizing: inherit; }
.hdrify-viewer :is(button, input, select) { font: inherit; color: inherit; }
.hdrify-viewer :is(button, input, select):focus-visible { outline: 2px solid var(--hv-ring); outline-offset: 1px; }
.hdrify-viewer [hidden] { display: none !important; }
.hdrify-viewer-viewport { position: absolute; inset: 0; display: flex; overflow: auto; }
.hdrify-viewer-canvas { display: block; flex: none; margin: auto; }
.hdrify-viewer[data-fit='contain'] .hdrify-viewer-canvas { width: 100%; height: 100%; object-fit: contain; }
.hdrify-viewer-status { position: absolute; left: 12px; bottom: 10px; color: var(--hv-muted); pointer-events: none; }
.hdrify-viewer-error {
  position: absolute; top: 12px; left: 12px; right: 12px; max-width: 460px; margin: 0; padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--hv-error) 40%, transparent); border-radius: var(--hv-radius);
  background: rgb(24 18 22 / 90%); color: var(--hv-error); overflow-wrap: anywhere;
}
.hdrify-viewer-surface {
  border: 1px solid var(--hv-border); border-radius: var(--hv-radius); background: var(--hv-popover);
  box-shadow: 0 6px 20px rgb(0 0 0 / 30%); backdrop-filter: blur(12px);
}
.hdrify-viewer-exposure {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%); height: min(260px, calc(100% - 24px));
  width: 52px; padding: 8px 0; display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.hdrify-viewer-exposure output { font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.hdrify-viewer-exposure input {
  flex: 1; min-height: 0; width: 20px; margin: 0; writing-mode: vertical-lr; direction: rtl;
  accent-color: var(--hv-primary); cursor: pointer;
}
.hdrify-viewer-toggle {
  position: absolute; right: 12px; bottom: 12px; display: grid; place-items: center; width: 36px; height: 36px;
  padding: 0; cursor: pointer;
}
.hdrify-viewer-panel {
  position: absolute; right: 12px; bottom: 56px; width: min(280px, calc(100% - 24px));
  max-height: calc(100% - 68px); overflow: auto; padding: 12px 14px;
}
.hdrify-viewer-panel header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.hdrify-viewer-panel header button {
  width: 26px; height: 26px; padding: 0; border: 0; border-radius: var(--hv-radius); background: transparent;
  font-size: 18px; line-height: 1; cursor: pointer;
}
.hdrify-viewer-panel label { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 10px 0; }
.hdrify-viewer-panel :is(select, input) {
  width: 128px; padding: 3px 6px; border: 1px solid var(--hv-border); border-radius: var(--hv-radius);
  background: var(--hv-input);
}
.hdrify-viewer-panel dl {
  display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 12px 0 0; padding-top: 10px;
  border-top: 1px solid var(--hv-border); color: var(--hv-muted); font-size: 12px;
}
.hdrify-viewer-panel dt { color: var(--hv-fg); }
.hdrify-viewer-panel dd { margin: 0; overflow-wrap: anywhere; }
`;
