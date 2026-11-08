/// <reference types="@webgpu/types" />
import type { HdrifyImage } from 'hdrify';
import { displayPixels, type ImageDisplay, type ViewerToneMapping } from './display.js';

// One full-screen triangle. UVs keep the source's first row at the top of the canvas.
// The canvas is tagged sRGB, so encode linear Rec.709 explicitly, preserving signed HDR values.
const SHADER = `
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vertex(@builtin(vertex_index) index: u32) -> Vertex {
  let uv = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  return Vertex(vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0), uv);
}
@group(0) @binding(0) var imageSampler: sampler;
@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(2) var<uniform> exposure: f32;
@fragment fn fragment(input: Vertex) -> @location(0) vec4f {
  let rgb = textureSample(image, imageSampler, input.uv).rgb * exposure;
  let magnitude = abs(rgb);
  let encoded = select(1.055 * pow(magnitude, vec3f(1.0 / 2.4)) - 0.055,
    magnitude * 12.92, magnitude <= vec3f(0.0031308));
  return vec4f(sign(rgb) * encoded, 1.0);
}`;

// Saturating float32 -> binary16, including subnormals and round-to-nearest-even.
const float = new Float32Array(1);
const bits = new Uint32Array(float.buffer);
function toHalfFloat(value: number): number {
  float[0] = Math.max(-65504, Math.min(65504, value));
  const word = bits[0]!;
  const sign = (word >>> 16) & 0x8000;
  const exponent = ((word >>> 23) & 0xff) - 127;
  if (exponent < -25) return sign;
  const mantissa = (word & 0x7fffff) | 0x800000;
  const shift = exponent < -14 ? -exponent - 1 : 13;
  const rounded = (mantissa + (2 ** (shift - 1) - 1) + ((mantissa >>> shift) & 1)) >>> shift;
  return sign | (exponent < -14 ? rounded : ((exponent + 14) << 10) + rounded);
}

/** A single FP16 texture drawn directly with WebGPU; unsupported presentation falls back to SDR. */
export async function createWebGPUDisplay(canvas: HTMLCanvasElement, onFailure: () => void): Promise<ImageDisplay> {
  const gpu = canvas.ownerDocument.defaultView?.navigator.gpu;
  const adapter = await gpu?.requestAdapter();
  if (!adapter) throw new Error('WebGPU is not available');
  const device = await adapter.requestDevice({
    requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
  });
  let disposed = false;
  let map: GPUTexture | undefined;
  let exposureBuffer: GPUBuffer | undefined;
  let context: GPUCanvasContext | null = null;
  const fail = () => {
    if (!disposed) onFailure();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    device.removeEventListener('uncapturederror', fail);
    context?.unconfigure();
    map?.destroy();
    exposureBuffer?.destroy();
    device.destroy();
  };
  try {
    device.addEventListener('uncapturederror', fail);
    void device.lost.then(fail);
    context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU canvas is not available');
    context.configure({
      device,
      format: 'rgba16float',
      colorSpace: 'srgb',
      alphaMode: 'opaque',
      toneMapping: { mode: 'extended' },
    });
    const configuration = context.getConfiguration();
    if (configuration?.format !== 'rgba16float' || configuration.toneMapping?.mode !== 'extended')
      throw new Error('WebGPU extended FP16 presentation is not supported');
    if (configuration.colorSpace !== 'srgb') throw new Error('Unexpected WebGPU canvas color space');
    const surface = context;
    const module = device.createShaderModule({ code: SHADER });
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });
    const uniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    exposureBuffer = uniformBuffer;
    const exposureValue = new Float32Array(1);
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    let bindings: GPUBindGroup | undefined;
    let previousImage: HdrifyImage | undefined;
    let previousToneMapping: ViewerToneMapping | undefined;
    let previousExposure: number | undefined;
    let wideSource = false;
    let size = '';
    return {
      mode: 'hdr',
      draw(image, toneMapping, exposure) {
        if (disposed) return;
        // Ordinary exposure-only changes are a uniform update. Explicit tone mappers use the same HDRify
        // operators as SDR, retaining float output rather than quantizing through an 8-bit preview.
        if (
          previousImage !== image ||
          previousToneMapping !== toneMapping ||
          ((toneMapping !== 'none' || wideSource) && previousExposure !== exposure)
        ) {
          const pixels = displayPixels(image, toneMapping, toneMapping === 'none' ? 1 : exposure);
          wideSource =
            toneMapping === 'none' && pixels.some((value, index) => index % 4 !== 3 && Math.abs(value) > 65504);
          // Bake exposure for values outside FP16's range, so lowering exposure can recover bright
          // float32 source highlights rather than magnifying an already-clipped upload.
          if (wideSource) for (let i = 0; i < pixels.length; i++) if (i % 4 !== 3) pixels[i] = pixels[i]! * exposure;
          const halves = new Uint16Array(pixels.length);
          for (let i = 0; i < pixels.length; i++) halves[i] = toHalfFloat(pixels[i]!);
          if (!map || map.width !== image.width || map.height !== image.height) {
            map?.destroy();
            map = device.createTexture({
              size: [image.width, image.height],
              format: 'rgba16float',
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            bindings = device.createBindGroup({
              layout: pipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: map.createView() },
                { binding: 2, resource: { buffer: uniformBuffer } },
              ],
            });
          }
          device.queue.writeTexture({ texture: map }, halves, { bytesPerRow: image.width * 8 }, [
            image.width,
            image.height,
          ]);
          previousImage = image;
          previousToneMapping = toneMapping;
        }
        previousExposure = exposure;
        exposureValue[0] = toneMapping === 'none' && !wideSource ? exposure : 1;
        device.queue.writeBuffer(uniformBuffer, 0, exposureValue);
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: surface.getCurrentTexture().createView(),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
            },
          ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindings);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
      },
      resize(width, height, pixelRatio) {
        const ratio = Math.min(pixelRatio, device.limits.maxTextureDimension2D / Math.max(width, height));
        const next = `${width}:${height}:${ratio}`;
        if (next === size) return;
        size = next;
        canvas.width = Math.max(1, Math.floor(width * ratio));
        canvas.height = Math.max(1, Math.floor(height * ratio));
      },
      complete: () => device.queue.onSubmittedWorkDone(),
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
