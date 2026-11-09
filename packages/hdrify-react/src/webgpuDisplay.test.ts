import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
});
afterEach(() => vi.unstubAllGlobals());

function environment(extended = true) {
  const devices: { destroy: ReturnType<typeof vi.fn> }[] = [];
  const requestDevice = vi.fn(async () => {
    const device = {
      destroy: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      lost: new Promise(() => {}),
      createShaderModule: vi.fn(() => ({})),
      createRenderPipelineAsync: vi.fn(async () => ({})),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createSampler: vi.fn(() => ({})),
    };
    devices.push(device);
    return device;
  });
  const requestAdapter = vi.fn(async () => ({ requestDevice, limits: { maxTextureDimension2D: 8192 } }));
  const probeContext = {
    configure: vi.fn(),
    unconfigure: vi.fn(),
    getConfiguration: vi.fn(() => ({
      format: 'rgba16float',
      colorSpace: 'srgb',
      toneMapping: { mode: extended ? 'extended' : 'standard' },
    })),
  };
  const document = {
    defaultView: { navigator: { gpu: { requestAdapter } } },
    createElement: vi.fn(() => ({ getContext: () => probeContext })),
  };
  const canvas = () =>
    ({
      ownerDocument: document,
      getContext: () => ({ configure: vi.fn(), unconfigure: vi.fn() }),
    }) as unknown as HTMLCanvasElement;
  return { canvas, requestAdapter, requestDevice, probeContext, devices };
}

describe('page-wide extended FP16 capability cache', () => {
  it('shares one in-flight probe while each viewer owns its device', async () => {
    const { createWebGPUDisplay } = await import('./webgpuDisplay.js');
    const env = environment();
    const [first, second] = await Promise.all([
      createWebGPUDisplay(env.canvas(), () => {}),
      createWebGPUDisplay(env.canvas(), () => {}),
    ]);
    expect(env.requestAdapter).toHaveBeenCalledTimes(3); // probe plus one resource adapter per viewer
    expect(env.probeContext.getConfiguration).toHaveBeenCalledTimes(1);
    expect(env.requestDevice).toHaveBeenCalledTimes(3); // one disposed probe, two independent viewers
    expect(env.devices[0].destroy).toHaveBeenCalledTimes(1);
    first.dispose();
    expect(env.devices[1].destroy).toHaveBeenCalledTimes(1);
    expect(env.devices[2].destroy).not.toHaveBeenCalled();
    second.dispose();
  });
  it('caches unsupported FP16 presentation instead of probing again', async () => {
    const { createWebGPUDisplay } = await import('./webgpuDisplay.js');
    const env = environment(false);
    for (let i = 0; i < 2; i++) await expect(createWebGPUDisplay(env.canvas(), () => {})).rejects.toThrow();
    expect(env.requestAdapter).toHaveBeenCalledTimes(1);
    expect(env.probeContext.getConfiguration).toHaveBeenCalledTimes(1);
    expect(env.devices[0].destroy).toHaveBeenCalledTimes(1);
  });
});
