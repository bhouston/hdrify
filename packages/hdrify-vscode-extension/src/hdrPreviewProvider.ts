import * as path from 'node:path';
import type { HdrifyImage } from 'hdrify';
import { readExr, readHdr, readJpegGainMap } from 'hdrify';
import * as vscode from 'vscode';
import { HdrPreviewDocument } from './hdrPreviewDocument.js';

const EXR_COMPRESSION_NAMES: Record<number, string> = {
  0: 'none',
  1: 'RLE',
  2: 'ZIPS',
  3: 'ZIP',
  4: 'PIZ',
  5: 'PXR24',
  6: 'B44',
  7: 'B44A',
};

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
    return EXR_COMPRESSION_NAMES[meta.compression as number] ?? `unknown (${meta.compression})`;
  }
  if (meta.format === 'ultrahdr') return 'Ultra HDR (JPEG-R)';
  if (meta.format === 'adobe-gainmap') return 'Adobe gain map';
  return '—';
}

export class HdrPreviewProvider implements vscode.CustomReadonlyEditorProvider<HdrPreviewDocument> {
  constructor(private readonly _context: vscode.ExtensionContext) {}

  async openCustomDocument(uri: vscode.Uri): Promise<HdrPreviewDocument> {
    const raw = await vscode.workspace.fs.readFile(uri);
    const buffer = new Uint8Array(raw);
    const fileSize = raw.length;
    const fileName = path.basename(uri.fsPath);
    const ext = path.extname(uri.fsPath);

    let image: HdrifyImage | null = null;
    let parseError: string | undefined;

    try {
      image = parseImage(buffer, ext);
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }

    return new HdrPreviewDocument(uri, fileSize, fileName, image, parseError);
  }

  async resolveCustomEditor(document: HdrPreviewDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'media')],
    };

    const scriptUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'preview.js'),
    );

    const html = getPreviewHtml(scriptUri);
    webviewPanel.webview.html = html;

    // Send document data to webview
    if (document.parseError) {
      webviewPanel.webview.postMessage({
        parseError: document.parseError,
        fileName: document.fileName,
      });
    } else if (document.image) {
      const img = document.image;
      const data = img.data.buffer;
      const payload = {
        width: img.width,
        height: img.height,
        linearColorSpace: img.linearColorSpace,
        metadata: img.metadata,
        fileSize: document.fileSize,
        fileName: document.fileName,
        fileExt: path.extname(document.uri.fsPath),
        internalFormat: getInternalFormat(img),
        data,
      };
      webviewPanel.webview.postMessage(payload);
    }
  }
}

function getPreviewHtml(scriptUri: vscode.Uri): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HDR Image Preview</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 12px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: center;
      margin-bottom: 12px;
      flex-shrink: 0;
    }
    .control-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .control-group label { font-weight: 500; min-width: 80px; }
    input[type="range"] { width: 120px; }
    select {
      padding: 4px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
    }
    .meta {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
      flex-shrink: 0;
    }
    .meta dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; }
    .meta dt { font-weight: 500; color: var(--vscode-foreground); }
    .meta dd { margin: 0; }
    .canvas-wrap {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
    }
    canvas { max-width: 100%; max-height: 100%; object-fit: contain; }
    .error { color: var(--vscode-errorForeground); padding: 16px; }
  </style>
</head>
<body>
  <div class="controls" id="controls" style="display:none">
    <div class="control-group">
      <label for="tonemap">Tone mapping</label>
      <select id="tonemap">
        <option value="neutral">Neutral</option>
        <option value="agx">AgX</option>
        <option value="aces">ACES</option>
      </select>
    </div>
    <div class="control-group">
      <label for="exposure">Exposure</label>
      <input type="range" id="exposure" min="0.1" max="10" step="0.1" value="1">
      <span id="exposureVal">1.0</span>
    </div>
  </div>
  <div class="meta" id="meta"></div>
  <div class="canvas-wrap">
    <canvas id="canvas"></canvas>
  </div>
  <div class="error" id="error" style="display:none"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}
