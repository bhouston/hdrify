import { applyToneMapping, linearTosRGB, type HdrifyImage } from 'hdrify';
import { displayPixels, type ViewerToneMapping } from './display.js';

/** Options for `toBlob()` on `<image-viewer>` and the {@link ImageViewer} handle. */
export interface ImageViewerCaptureOptions {
  /** `image/png` (default), `image/jpeg` or `image/webp`. Browsers that cannot encode a type return a PNG. */
  type?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Encoding quality from 0 to 1 for JPEG and WebP. */
  quality?: number;
  /** Output size in pixels. Without either, the image's own size; with one, the other keeps the aspect ratio. */
  width?: number;
  height?: number;
}

/** Tone map `image` into `canvas`, resizing the canvas to the image. The result is opaque sRGB. */
export function drawToneMapped(
  canvas: HTMLCanvasElement,
  image: HdrifyImage,
  toneMapping: ViewerToneMapping,
  exposure: number,
): void {
  const { width, height } = image;
  canvas.width = width;
  canvas.height = height;
  // LDR from applyToneMapping is sRGB; use an srgb canvas so it displays correctly.
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' }) ?? canvas.getContext('2d');
  if (!ctx) return;
  if (toneMapping === 'none') {
    const linear = displayPixels(image, 'none', exposure);
    const imageData = ctx.createImageData(width, height);
    for (let i = 0; i < linear.length; i += 4) {
      for (let c = 0; c < 3; c++)
        imageData.data[i + c] = Math.round(Math.max(0, Math.min(1, linearTosRGB(linear[i + c]!))) * 255);
      imageData.data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    return;
  }
  const ldrRgb = applyToneMapping(image.data.slice(), width, height, {
    toneMapping,
    exposure,
    sourceColorSpace: image.linearColorSpace,
  });
  const imageData = ctx.createImageData(width, height);
  const pixels = imageData.data;
  for (let destIndex = 0, sourceIndex = 0; sourceIndex < ldrRgb.length; destIndex += 4, sourceIndex += 3) {
    pixels[destIndex] = ldrRgb[sourceIndex]!;
    pixels[destIndex + 1] = ldrRgb[sourceIndex + 1]!;
    pixels[destIndex + 2] = ldrRgb[sourceIndex + 2]!;
    pixels[destIndex + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

/** Output size for a capture; throws on sizes that are not positive integers up to 16384 pixels. */
export function captureSize(options: ImageViewerCaptureOptions, imageWidth: number, imageHeight: number) {
  const width = options.width ?? Math.round(((options.height ?? imageHeight) * imageWidth) / imageHeight);
  const height = options.height ?? Math.round((width * imageHeight) / imageWidth);
  if (![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= 16384))
    throw new RangeError('Capture width and height must be positive integers up to 16384.');
  return { width, height };
}

/** Encode `image` tone mapped with the given settings, independently of what is on screen. */
export async function captureImage(
  image: HdrifyImage,
  toneMapping: ViewerToneMapping,
  exposure: number,
  options: ImageViewerCaptureOptions = {},
): Promise<Blob> {
  const { width, height } = captureSize(options, image.width, image.height);
  let canvas = document.createElement('canvas');
  drawToneMapped(canvas, image, toneMapping, exposure);
  if (width !== image.width || height !== image.height) {
    const scaled = document.createElement('canvas');
    scaled.width = width;
    scaled.height = height;
    const ctx = scaled.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, width, height);
    canvas = scaled;
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the image.'))),
      options.type ?? 'image/png',
      options.quality,
    ),
  );
}
