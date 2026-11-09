import type { CustomDocument, Uri } from 'vscode';

/** Keep encoded bytes; the shared React viewer owns format detection and decoding. */
export class HdrPreviewDocument implements CustomDocument {
  constructor(
    public readonly uri: Uri,
    public readonly fileName: string,
    public readonly data: ArrayBuffer,
  ) {}

  dispose(): void {
    // No resources to dispose for readonly document
  }
}
