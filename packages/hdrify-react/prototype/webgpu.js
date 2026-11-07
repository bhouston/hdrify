import { convertFloat32ToLinearColorSpace } from '../../hdrify/src/color/convert.ts';

const shader = `
struct Settings { width: u32, exposure: f32, encoded: u32, pad: u32 }
@group(0) @binding(0) var<storage, read> pixels: array<vec4f>;
@group(0) @binding(1) var<uniform> settings: Settings;
@vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(positions[i], 0, 1);
}
fn encode(v: vec3f) -> vec3f {
  let a = abs(v);
  return sign(v) * select(1.055 * pow(a, vec3f(1.0 / 2.4)) - 0.055, 12.92 * a, a <= vec3f(0.0031308));
}
@fragment fn fragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let source = pixels[u32(p.y) * settings.width + u32(p.x)];
  var rgb = source.rgb * settings.exposure;
  if (settings.encoded != 0u) { rgb = encode(rgb); }
  return vec4f(clamp(rgb, vec3f(-65504), vec3f(65504)), 1);
}`;

export async function createGpuSurface() {
  const canvas = document.createElement('canvas');
  canvas.style.setProperty('dynamic-range-limit', 'no-limit');
  const surface = { canvas, supported: false, extended: false };
  try {
    if (!navigator.gpu) throw new Error('WebGPU unavailable');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter');
    surface.adapter = {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      device: adapter.info.device,
      description: adapter.info.description,
      isFallbackAdapter: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter,
    };
    if (surface.adapter.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe/i.test(JSON.stringify(surface.adapter)))
      throw new Error('Software WebGPU adapter rejected');
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU canvas unavailable');
    for (const colorSpace of ['display-p3-linear', 'srgb-linear', 'display-p3', 'srgb']) {
      try {
        device.pushErrorScope('validation');
        let configureError;
        try {
          context.configure({
            device,
            format: 'rgba16float',
            colorSpace,
            toneMapping: { mode: 'extended' },
            alphaMode: 'opaque',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
          });
        } catch (error) {
          configureError = error;
        }
        const validation = await device.popErrorScope();
        if (configureError || validation) throw configureError ?? new Error(validation.message);
        const configuration = context.getConfiguration();
        if (configuration?.colorSpace !== colorSpace || configuration?.format !== 'rgba16float') continue;
        surface.configuration = {
          colorSpace,
          format: configuration.format,
          alphaMode: configuration.alphaMode,
          toneMapping: configuration.toneMapping,
        };
        surface.extended = configuration.toneMapping?.mode === 'extended';
        break;
      } catch {
        /* Try the next supported encoding on this same WebGPU context. */
      }
    }
    if (!surface.configuration) throw new Error('No FP16 canvas configuration accepted');
    const module = device.createShaderModule({ code: shader });
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format: 'rgba16float' }] },
    });
    const uniforms = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    let sourceBuffer;
    let sourceImage;
    let bindGroup;
    surface.draw = async (image, exposureEV = 0, readback = false) => {
      if (sourceImage !== image) {
        sourceBuffer?.destroy();
        const target = surface.configuration.colorSpace.startsWith('display-p3') ? 'linear-p3' : 'linear-rec709';
        const source = image.data.slice();
        for (let i = 0; i < source.length; i++) if (!Number.isFinite(source[i])) source[i] = i % 4 === 3 ? 1 : 0;
        const converted = convertFloat32ToLinearColorSpace(
          source,
          image.width,
          image.height,
          image.linearColorSpace,
          target,
        );
        if (converted.byteLength > device.limits.maxStorageBufferBindingSize)
          throw new Error('Image exceeds the WebGPU storage binding limit');
        sourceBuffer = device.createBuffer({
          size: converted.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(sourceBuffer, 0, converted);
        bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: sourceBuffer } },
            { binding: 1, resource: { buffer: uniforms } },
          ],
        });
        sourceImage = image;
      }
      canvas.width = image.width;
      canvas.height = image.height;
      const settings = new ArrayBuffer(16);
      const view = new DataView(settings);
      view.setUint32(0, image.width, true);
      view.setFloat32(4, 2 ** exposureEV, true);
      view.setUint32(8, surface.configuration.colorSpace.endsWith('-linear') ? 0 : 1, true);
      device.queue.writeBuffer(uniforms, 0, settings);
      const texture = context.getCurrentTexture();
      const commands = device.createCommandEncoder();
      const pass = commands.beginRenderPass({
        colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      let staging;
      const bytesPerRow = Math.ceil((image.width * 8) / 256) * 256;
      if (readback) {
        staging = device.createBuffer({
          size: bytesPerRow * image.height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        commands.copyTextureToBuffer(
          { texture },
          { buffer: staging, bytesPerRow },
          { width: image.width, height: image.height },
        );
      }
      device.queue.submit([commands.finish()]);
      if (!staging) return undefined;
      await staging.mapAsync(GPUMapMode.READ);
      const packed = new Float16Array(staging.getMappedRange());
      const pixels = Array.from({ length: image.height }, (_, row) =>
        Array.from(packed.slice((row * bytesPerRow) / 2, (row * bytesPerRow) / 2 + image.width * 4)),
      ).flat();
      staging.unmap();
      staging.destroy();
      return pixels;
    };
    surface.supported = true;
    void device.lost.then((info) => {
      surface.error = `Device lost: ${info.message}`;
      surface.supported = false;
    });
  } catch (error) {
    surface.error = String(error);
  }
  return surface;
}
