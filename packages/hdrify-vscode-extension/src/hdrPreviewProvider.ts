import * as path from 'node:path';
import * as vscode from 'vscode';
import { HdrPreviewDocument } from './hdrPreviewDocument.js';
import { getPreviewHtml } from './previewHtml.js';
import type { PreviewUpdate } from './protocol.js';

export class HdrPreviewProvider implements vscode.CustomReadonlyEditorProvider<HdrPreviewDocument> {
  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _log: vscode.OutputChannel,
  ) {}

  async openCustomDocument(uri: vscode.Uri): Promise<HdrPreviewDocument> {
    this._log.appendLine(`[open] ${uri.fsPath}`);
    const raw = await vscode.workspace.fs.readFile(uri);
    return new HdrPreviewDocument(uri, path.basename(uri.fsPath), Uint8Array.from(raw).buffer);
  }

  async resolveCustomEditor(document: HdrPreviewDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    this._log.appendLine(`[resolve] ${document.fileName}`);
    const media = vscode.Uri.joinPath(this._context.extensionUri, 'media');
    const webview = webviewPanel.webview;
    webview.options = { enableScripts: true, localResourceRoots: [media] };
    const resource = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(media, name)).toString();
    // Attach before assigning HTML: the React webview may announce readiness immediately.
    const listener = webview.onDidReceiveMessage((msg: { type?: string }) => {
      if (msg?.type !== 'ready') return;
      const payload: PreviewUpdate = { type: 'update', fileName: document.fileName, data: document.data };
      // VS Code's webview API posts only to this panel.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      void webview.postMessage(payload);
    });
    webviewPanel.onDidDispose(() => listener.dispose());
    webview.html = getPreviewHtml(resource('preview.js'), resource('preview.css'), webview.cspSource);
  }
}
