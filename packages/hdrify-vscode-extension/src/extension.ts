import * as path from 'node:path';
import * as vscode from 'vscode';
import { convertToFormat } from './hdrifyOperations.js';
import { HdrPreviewProvider } from './hdrPreviewProvider.js';

const SUPPORTED_EXTENSIONS = new Set(['.exr', '.hdr', '.jpg', '.jpeg']);

function filterImageUris(uris: vscode.Uri[]): vscode.Uri[] {
  return uris.filter((u) => {
    const ext = path.extname(u.fsPath).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  });
}

function normalizeUris(uri: vscode.Uri | undefined, selectedResources?: vscode.Uri[]): vscode.Uri[] {
  const first = uri ?? getSelectedFileUri();
  if (!first) return [];
  if (!selectedResources?.length) return [first];
  const seen = new Set<string>([first.toString()]);
  const result: vscode.Uri[] = [first];
  for (const u of selectedResources) {
    const key = u.toString();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(u);
    }
  }
  return result;
}

async function runConvert(uris: vscode.Uri[], format: 'exr' | 'hdr' | 'jpeg'): Promise<void> {
  const formatLabel = format === 'jpeg' ? 'UltraHDR Jpeg' : format.toUpperCase();
  if (uris.length > 1) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Converting images to ${formatLabel}…`,
        cancellable: false,
      },
      async (progress) => {
        const increment = 100 / uris.length;
        for (const u of uris) {
          try {
            // biome-ignore lint/performance/noAwaitInLoops: sequential for progress reporting
            await convertToFormat(u, format, { silent: true });
          } catch {
            // Error already shown by convertToFormat
          }
          progress.report({ increment });
        }
      },
    );
  } else {
    for (const u of uris) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: sequential for single-file toast
        await convertToFormat(u, format);
      } catch {
        // Error already shown
      }
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const previewProvider = new HdrPreviewProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('hdrify.hdrPreview', previewProvider, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
  );

  const convertFormats = ['exr', 'hdr', 'jpeg'] as const;
  for (const format of convertFormats) {
    // biome-ignore lint/security/noSecrets: VS Code command ID, not a secret
    const command = `hdrify.convertTo${format === 'exr' ? 'Exr' : format === 'hdr' ? 'Hdr' : 'UltraHdrJpeg'}` as const;
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async (uri: vscode.Uri, selectedResources?: vscode.Uri[]) => {
        const all = normalizeUris(uri, selectedResources);
        if (!all.length) {
          vscode.window.showErrorMessage('HDRify: No file selected. Right-click an image in the Explorer.');
          return;
        }
        const uris = filterImageUris(all);
        if (!uris.length) return;
        await runConvert(uris, format);
      }),
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      // biome-ignore lint/security/noSecrets: VS Code command ID, not a secret
      'hdrify.openHdrPreview',
      async (uri: vscode.Uri) => {
        const resource = uri ?? getSelectedFileUri();
        if (!resource) {
          vscode.window.showErrorMessage('HDRify: No file selected. Right-click a JPEG in the Explorer.');
          return;
        }
        await vscode.commands.executeCommand('vscode.openWith', resource, 'hdrify.hdrPreview');
      },
    ),
  );
}

function getSelectedFileUri(): vscode.Uri | undefined {
  return vscode.window.activeTextEditor?.document.uri;
}

export function deactivate(): void {}
