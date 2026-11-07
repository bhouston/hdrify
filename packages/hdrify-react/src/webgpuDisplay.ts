/// <reference types="@webgpu/types" />
import type { HdrifyImage } from 'hdrify';
import {
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  MeshBasicNodeMaterial,
  NoToneMapping,
  QuadMesh,
  Renderer,
  RGBAFormat,
  WebGPUBackend,
} from 'three/webgpu';
import { select, texture, uniform, vec3, vec4 } from 'three/tsl';
import { displayPixels, type ImageDisplay, type ViewerToneMapping } from './display.js';

/** Use an explicit WebGPU backend so Three.js cannot silently fall back to WebGL. */
export async function createWebGPUDisplay(canvas: HTMLCanvasElement, onFailure: () => void): Promise<ImageDisplay> {
  const parameters = {
    canvas,
    outputType: HalfFloatType,
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
  };
  const renderer = new Renderer(new WebGPUBackend(parameters), parameters);
  let disposed = false;
  let map: DataTexture | undefined;
  let material: MeshBasicNodeMaterial | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    map?.dispose();
    material?.dispose();
    void renderer.dispose().catch(() => {});
  };
  try {
    renderer.onDeviceLost = () => {
      if (!disposed) onFailure();
    };
    renderer.onError = () => {
      if (!disposed) onFailure();
    };
    await renderer.init();
    const context = renderer.getContext() as GPUCanvasContext; // Initializes Three's lazily configured canvas.
    const configuration = context?.getConfiguration();
    if (configuration?.format !== 'rgba16float' || configuration.toneMapping?.mode !== 'extended')
      throw new Error('WebGPU extended FP16 presentation is not supported');

    // Three ignores explicit destroy() in its loss callback; external destruction must also fall back.
    void configuration.device.lost.then(() => {
      if (!disposed) onFailure();
    });

    // Three's canvas is tagged sRGB. Encode explicitly, including negative extended-gamut values.
    // LinearSRGBColorSpace disables an additional output encoding by Three.
    if (configuration.colorSpace !== 'srgb') throw new Error('Unexpected WebGPU canvas color space');
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.toneMapping = NoToneMapping;
    map = new DataTexture(new Uint16Array([0, 0, 0, 0x3c00]), 1, 1, RGBAFormat, HalfFloatType);
    map.colorSpace = LinearSRGBColorSpace;
    map.magFilter = LinearFilter;
    map.minFilter = LinearFilter;
    map.generateMipmaps = false;
    map.flipY = false;
    const exposureNode = uniform(1);
    const mapNode = texture(map);
    const rgb = mapNode.rgb.mul(exposureNode);
    const encodeChannel = (value: typeof rgb.r) => {
      const magnitude = value.abs();
      return value.sign().mul(
        select(
          magnitude.lessThanEqual(0.0031308),
          magnitude.mul(12.92),
          magnitude
            .pow(1 / 2.4)
            .mul(1.055)
            .sub(0.055),
        ),
      );
    };
    const encoded = vec3(encodeChannel(rgb.r), encodeChannel(rgb.g), encodeChannel(rgb.b));
    material = new MeshBasicNodeMaterial();
    material.fragmentNode = vec4(encoded, 1);
    material.depthTest = false;
    material.depthWrite = false;
    const quad = new QuadMesh(material);
    let previousImage: HdrifyImage | undefined;
    let previousToneMapping: ViewerToneMapping | undefined;
    let previousExposure: number | undefined;
    let size = '';
    return {
      mode: 'hdr',
      draw(image, toneMapping, exposure) {
        if (disposed) return;
        // Exposure-only changes are a uniform update. Explicit tone mappers use the same HDRify
        // operators as SDR, retaining float output rather than quantizing through an 8-bit preview.
        if (
          previousImage !== image ||
          previousToneMapping !== toneMapping ||
          (toneMapping !== 'none' && previousExposure !== exposure)
        ) {
          const pixels = displayPixels(image, toneMapping, toneMapping === 'none' ? 1 : exposure);
          const halves = new Uint16Array(pixels.length);
          for (let i = 0; i < pixels.length; i++)
            halves[i] = DataUtils.toHalfFloat(Math.max(-65504, Math.min(65504, pixels[i]!)));
          if (map!.image.width !== image.width || map!.image.height !== image.height) {
            map!.dispose();
            map = new DataTexture(halves, image.width, image.height, RGBAFormat, HalfFloatType);
            map.colorSpace = LinearSRGBColorSpace;
            map.magFilter = LinearFilter;
            map.minFilter = LinearFilter;
            map.generateMipmaps = false;
            map.flipY = false;
            mapNode.value = map;
          } else map!.image.data = halves;
          map!.needsUpdate = true;
          previousImage = image;
          previousToneMapping = toneMapping;
        }
        previousExposure = exposure;
        exposureNode.value = toneMapping === 'none' ? exposure : 1;
        quad.render(renderer);
      },
      resize(width, height, pixelRatio) {
        const ratio = Math.min(pixelRatio, configuration.device.limits.maxTextureDimension2D / Math.max(width, height));
        const next = `${width}:${height}:${ratio}`;
        if (next === size) return;
        size = next;
        renderer.setDrawingBufferSize(width, height, ratio);
      },
      complete: () => configuration.device.queue.onSubmittedWorkDone(),
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
