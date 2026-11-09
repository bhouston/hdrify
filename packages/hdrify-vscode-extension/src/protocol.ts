/** Encoded file transport shared by the extension host and React webview. */
export interface PreviewUpdate {
  type: 'update';
  fileName: string;
  data: ArrayBuffer;
}

export function isPreviewUpdate(value: unknown): value is PreviewUpdate {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'update' &&
    'fileName' in value &&
    typeof value.fileName === 'string' &&
    'data' in value &&
    value.data instanceof ArrayBuffer
  );
}
