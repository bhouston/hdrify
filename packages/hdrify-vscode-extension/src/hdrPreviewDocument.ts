import type { HdrifyImage } from 'hdrify';
import type { CustomDocument } from 'vscode';

export class HdrPreviewDocument implements CustomDocument {
  constructor(
    public readonly uri: import('vscode').Uri,
    public readonly fileSize: number,
    public readonly fileName: string,
    public readonly image: HdrifyImage | null,
    public readonly parseError?: string,
  ) {}

  dispose(): void {
    // No resources to dispose for readonly document
  }
}
