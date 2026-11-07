import * as path from 'node:path';
import type { HdrifyImage } from 'hdrify';
import { EXR_COMPRESSION_NAMES, readExr, readHdr, readJpegGainMap } from 'hdrify';
import * as vscode from 'vscode';
import { HdrPreviewDocument } from './hdrPreviewDocument.js';

function parseImage(buffer: Uint8Array, ext: string): HdrifyImage {
  const lower = ext.toLowerCase();
  if (lower === '.exr') {
    return readExr(buffer);
  }
  if (lower === '.hdr') {
    return readHdr(buffer);
  }
  if (lower === '.jpg' || lower === '.jpeg') {
    return readJpegGainMap(buffer);
  }
  throw new Error(`Unsupported format: ${ext}`);
}

function getInternalFormat(image: HdrifyImage): string {
  const meta = image.metadata;
  if (!meta) return '—';
  if (meta.compression != null) {
    return EXR_COMPRESSION_NAMES[meta.compression as number] ?? `unknown (${JSON.stringify(meta.compression)})`;
  }
  if (meta.format === 'ultrahdr') return 'Ultra HDR (JPEG-R)';
  if (meta.format === 'adobe-gainmap') return 'Adobe gain map';
  return '—';
}

export class HdrPreviewProvider implements vscode.CustomReadonlyEditorProvider<HdrPreviewDocument> {
  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _log: vscode.OutputChannel,
  ) {}

  async openCustomDocument(uri: vscode.Uri): Promise<HdrPreviewDocument> {
    this._log.appendLine(`[open] ${uri.fsPath}`);
    const raw = await vscode.workspace.fs.readFile(uri);
    const buffer = new Uint8Array(raw);
    const fileSize = raw.length;
    const fileName = path.basename(uri.fsPath);
    const ext = path.extname(uri.fsPath);

    let image: HdrifyImage | null = null;
    let parseError: string | undefined;

    try {
      image = parseImage(buffer, ext);
      this._log.appendLine(`[open] parsed ${fileName}: ${image.width}x${image.height}`);
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
      this._log.appendLine(`[open] parse error for ${fileName}: ${parseError}`);
    }

    return new HdrPreviewDocument(uri, fileSize, fileName, image, parseError);
  }

  async resolveCustomEditor(document: HdrPreviewDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    this._log.appendLine(`[resolve] ${document.fileName}`);
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'media')],
    };

    const scriptUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'preview.js'),
    );

    webviewPanel.webview.html = getPreviewHtml(scriptUri, webviewPanel.webview.cspSource);

    const send = (): void => {
      this._log.appendLine(`[send] ${document.fileName} (visible=${webviewPanel.visible})`);
      // VS Code Webview.postMessage has no targetOrigin
      /* oxlint-disable unicorn/require-post-message-target-origin */
      if (document.parseError) {
        webviewPanel.webview.postMessage({
          parseError: document.parseError,
          fileName: document.fileName,
        });
      } else if (document.image) {
        const img = document.image;
        const payload = {
          width: img.width,
          height: img.height,
          linearColorSpace: img.linearColorSpace,
          metadata: img.metadata,
          fileSize: document.fileSize,
          fileName: document.fileName,
          fileExt: path.extname(document.uri.fsPath),
          internalFormat: getInternalFormat(img),
          data: img.data.buffer,
        };
        webviewPanel.webview.postMessage(payload);
      }
      /* oxlint-enable unicorn/require-post-message-target-origin */
    };

    // The webview script may not have attached its message listener yet when this
    // runs, so wait for it to announce readiness instead of racing a blind postMessage.
    webviewPanel.webview.onDidReceiveMessage((msg: { type?: string }) => {
      if (msg?.type === 'ready') {
        this._log.appendLine(`[ready] ${document.fileName}`);
        send();
      }
    });
  }
}

function getPreviewHtml(scriptUri: vscode.Uri, cspSource: string): string {
  // The viewer's React UI renders inline <style> elements, hence 'unsafe-inline' for styles only.
  const csp = [
    "default-src 'none'",
    `script-src ${cspSource}`,
    `style-src ${cspSource} 'unsafe-inline'`,
    'img-src data: blob:',
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HDR Image Preview</title>
  <style>
    html, body { margin: 0; height: 100%; }
    body {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    /* The shared viewer theme follows VS Code; custom properties inherit into its shadow root. */
    image-viewer {
      flex: 1;
      height: auto;
      min-height: 0;
      --hdrify-viewer-background: var(--vscode-editor-background);
      --hdrify-viewer-foreground: var(--vscode-foreground);
      --hdrify-viewer-muted-foreground: var(--vscode-descriptionForeground);
      --hdrify-viewer-popover: var(--vscode-editorWidget-background);
      --hdrify-viewer-border: var(--vscode-widget-border, var(--vscode-panel-border));
      --hdrify-viewer-input: var(--vscode-input-background);
      --hdrify-viewer-primary: var(--vscode-button-background);
      --hdrify-viewer-ring: var(--vscode-focusBorder);
      --hdrify-viewer-destructive: var(--vscode-errorForeground);
    }
    #status {
      flex-shrink: 0;
      padding: 6px 12px;
      border-top: 1px solid var(--vscode-panel-border, transparent);
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    #status.error { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <image-viewer exposure-control aria-label="HDR image preview"></image-viewer>
  <output id="status">Loading…</output>
  <script src="${scriptUri.toString()}"></script>
</body>
</html>`;
}
