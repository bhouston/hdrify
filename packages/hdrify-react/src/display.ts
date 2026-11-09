import { convertFloat32ToLinearColorSpace, getToneMapping, type HdrifyImage, type ToneMappingType } from 'hdrify';

/** `none` preserves HDR values; omitting the setting chooses None for HDR and Neutral for SDR. */
export type ViewerToneMapping = ToneMappingType | 'none';
export type DisplayMode = 'hdr' | 'sdr';

/** None is valid only after the renderer enables extended FP16 HDR presentation. */
export function resolveToneMapping(toneMapping: ViewerToneMapping | undefined, mode: DisplayMode): ViewerToneMapping {
  if (toneMapping === undefined || toneMapping === 'none') return mode === 'hdr' ? 'none' : 'neutral';
  return toneMapping;
}

/** Prepare display pixels without changing the decoded image. Output is linear Rec.709 RGBA. */
export function displayPixels(image: HdrifyImage, toneMapping: ViewerToneMapping, exposure = 1): Float32Array {
  const source = image.data.slice();
  for (let i = 0; i < source.length; i++) if (!Number.isFinite(source[i])) source[i] = 0;
  const pixels = convertFloat32ToLinearColorSpace(
    source,
    image.width,
    image.height,
    image.linearColorSpace,
    'linear-rec709',
  );
  if (toneMapping === 'none') {
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = pixels[i]! * exposure;
      pixels[i + 1] = pixels[i + 1]! * exposure;
      pixels[i + 2] = pixels[i + 2]! * exposure;
      pixels[i + 3] = 1;
    }
  } else {
    const rgb = new Float32Array(image.width * image.height * 3);
    for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3) {
      rgb[j] = Math.max(0, pixels[i]!) * exposure;
      rgb[j + 1] = Math.max(0, pixels[i + 1]!) * exposure;
      rgb[j + 2] = Math.max(0, pixels[i + 2]!) * exposure;
    }
    getToneMapping(toneMapping)(rgb, rgb, image.width * image.height);
    for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3) {
      pixels.set([rgb[j]!, rgb[j + 1]!, rgb[j + 2]!, 1], i);
    }
  }
  return pixels;
}

/** Rendering surface owned by HdrifyCanvas. Draws on demand, without an animation loop. */
export interface ImageDisplay {
  readonly mode: DisplayMode;
  draw(image: HdrifyImage, toneMapping: ViewerToneMapping, exposure: number): void;
  resize(width: number, height: number, pixelRatio: number): void;
  complete(): Promise<void>;
  dispose(): void;
}
