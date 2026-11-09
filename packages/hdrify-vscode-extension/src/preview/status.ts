import { EXR_COMPRESSION_NAMES, type HdrifyImage } from 'hdrify';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Describe actual decoder metadata; Modular encoding does not itself prove losslessness. */
export function previewStatus(fileName: string, fileSize: number, image: HdrifyImage): string {
  const meta = image.metadata;
  const details: string[] = [];
  if (typeof meta?.compression === 'number')
    details.push(EXR_COMPRESSION_NAMES[meta.compression] ?? `unknown (${JSON.stringify(meta.compression)})`);
  if (meta?.format === 'ultrahdr') details.push('Ultra HDR (JPEG-R)');
  if (meta?.format === 'adobe-gainmap') details.push('Adobe gain map');
  if (meta?.format === 'JPEG XL') {
    details.push(
      'JPEG XL',
      `${JSON.stringify(meta.bitsPerSample)}-bit ${meta.floatSample ? 'float' : 'integer'}`,
      JSON.stringify(meta.encoding),
      image.linearColorSpace,
    );
    const animation = meta.animation;
    if (
      typeof animation === 'object' &&
      animation !== null &&
      'frameCount' in animation &&
      typeof animation.frameCount === 'number'
    )
      details.push(`${animation.frameCount} frames (showing first)`);
  }
  return [
    fileName,
    `${image.width} × ${image.height}`,
    `${(image.width * image.height).toLocaleString()} pixels`,
    formatFileSize(fileSize),
    ...details,
  ].join(' · ');
}
