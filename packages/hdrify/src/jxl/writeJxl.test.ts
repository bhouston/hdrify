import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeFloat16, encodeFloat16 } from '../exr/halfFloat.js';
import { linearTosRGB } from '../color/srgb.js';
import { nitsToPq, sceneToHlg } from '../color/transfer.js';
import { readExr } from '../exr/readExr.js';
import type { HdrifyImage } from '../hdrifyImage.js';
import { readJxl } from './readJxl.js';
import { type WriteJxlOptions, writeJxl } from './writeJxl.js';

const hasDjxl = spawnSync('djxl', ['--version']).status === 0;
const COLOR_ASSETS = new URL('../../../../assets/jxl/color/', import.meta.url);
/** Grey ramp 0..1 at 1000 nits, and the reference encodings of a grey value (HLG OOTF gamma is 1.2 at 1000 nits). */
const greyRamp = (n: number): HdrifyImage => ({
  ...makeImage(n, 1, (x, _y, c) => (c === 3 ? 1 : x / (n - 1))),
  metadata: { linearReferenceWhiteNits: 1000 },
});
const TRANSFER_REFERENCE = {
  srgb: linearTosRGB,
  pq: (v: number) => nitsToPq(v * 1000),
  hlg: (v: number) => sceneToHlg(v ** (1 / 1.2)),
} as const;
const readColorAsset = (name: string): HdrifyImage => readJxl(fs.readFileSync(new URL(name, COLOR_ASSETS)));

function makeImage(
  width: number,
  height: number,
  fn: (x: number, y: number, c: number) => number,
  linearColorSpace: HdrifyImage['linearColorSpace'] = 'linear-rec709',
): HdrifyImage {
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = fn(x, y, c);
    }
  }
  return { width, height, data, linearColorSpace };
}

/** Deterministic HDR-ish test pattern: gradients, a sine, and pseudo-random noise above 1. */
function pattern(width: number, height: number, alpha: (x: number, y: number) => number = () => 1): HdrifyImage {
  let seed = 12345;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 2 ** 32;
  };
  return makeImage(width, height, (x, y, c) => {
    if (c === 3) return alpha(x, y);
    if (c === 0) return (x / width) * 8 + rand() * 0.01;
    if (c === 1) return Math.sin(x * 0.2 + y * 0.1) * 0.5 + 0.5;
    return y / height + rand() * 2;
  });
}

/** Parse a PFM (bottom-to-top rows) into top-to-bottom interleaved RGB. */
function readPfm(buf: Uint8Array): { width: number; height: number; rgb: Float32Array } {
  const text = new TextDecoder('latin1').decode(buf.subarray(0, 64));
  const m = /^PF\s+(\d+)\s+(\d+)\s+(-?[\d.]+)\s/.exec(text);
  if (!m) throw new Error('bad PFM');
  const [width, height, scale] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dv = new DataView(buf.buffer, buf.byteOffset + m[0].length);
  const rgb = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < width * 3; i++) {
      rgb[(height - 1 - y) * width * 3 + i] = dv.getFloat32((y * width * 3 + i) * 4, scale < 0);
    }
  }
  return { width, height, rgb };
}

/** First differing sample (bitwise, or within `tol`), described for a cheap failure message. */
function firstMismatch(got: Float32Array, want: Float32Array, tol: number): string {
  const g = new Uint32Array(got.buffer, got.byteOffset, got.length);
  const w = new Uint32Array(want.buffer, want.byteOffset, want.length);
  for (let i = 0; i < want.length; i++) {
    if (tol ? Math.abs(got[i] - want[i]) > tol : g[i] !== w[i]) {
      return `sample ${i} (pixel ${Math.floor(i / 3)}, channel ${i % 3}): got ${got[i]}, want ${want[i]}`;
    }
  }
  return 'none';
}

/** Expected decoded value of one sample for `bitDepth`. */
function expected(v: number, bitDepth: WriteJxlOptions['bitDepth']): number {
  if (bitDepth === 'float32') return v;
  if (bitDepth === 'uint8') return Math.round(Math.min(1, Math.max(0, v)) * 255) / 255;
  if (bitDepth === 'uint16') return Math.round(Math.min(1, Math.max(0, v)) * 65535) / 65535;
  return decodeFloat16(encodeFloat16(v));
}

describe.skipIf(!hasDjxl)('writeJxl decoded by libjxl djxl', () => {
  let dir: string;
  let n = 0;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdrify-jxl-'));
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function encode(image: HdrifyImage, options?: WriteJxlOptions): string {
    const file = path.join(dir, `t${n++}.jxl`);
    fs.writeFileSync(file, writeJxl(image, options));
    return file;
  }

  function djxl(file: string, ext: string): Uint8Array {
    const out = `${file}.${ext}`;
    const r = spawnSync('djxl', [file, out], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`djxl failed: ${r.stderr}`);
    return fs.readFileSync(out);
  }

  function expectRgb(image: HdrifyImage, options?: WriteJxlOptions): void {
    const { width, height, rgb } = readPfm(djxl(encode(image, options), 'pfm'));
    expect([width, height]).toEqual([image.width, image.height]);
    const want = new Float32Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      for (let c = 0; c < 3; c++) want[i * 3 + c] = expected(image.data[i * 4 + c], options?.bitDepth);
    }
    expect(firstMismatch(rgb, want, options?.bitDepth?.startsWith('uint') ? 1e-6 : 0)).toBe('none');
  }

  function jxlinfo(file: string): string {
    return spawnSync('jxlinfo', [file], { encoding: 'utf8' }).stdout;
  }

  /** Decode via EXR (keeps alpha) and return RGBA floats. */
  function decodeExr(file: string): HdrifyImage {
    return readExr(djxl(file, 'exr'));
  }

  const sizes: [number, number][] = [
    [1, 1],
    [2, 1],
    [1, 7],
    [17, 5],
    [256, 256], // exactly one group
    [257, 3], // two groups, one 1 pixel wide
    [300, 260], // 2x2 groups with partial edge groups
  ];
  for (const bitDepth of ['float32', 'float16'] as const) {
    for (const [w, h] of sizes) {
      it(`${bitDepth} ${w}x${h} round-trips exactly`, () => expectRgb(pattern(w, h), { bitDepth }));
    }
  }

  it('many small groups and two LF groups (groupSizeShift 0)', () => {
    expectRgb(pattern(1030, 3), { bitDepth: 'float32', groupSizeShift: 0 });
    expectRgb(pattern(130, 260), { groupSizeShift: 0 });
  });

  it('writes the intensity target that libjxl reports and decodes with', () => {
    const image = readColorAsset('pq-d0.jxl');
    const file = encode(image, { bitDepth: 'float32' });
    expect(jxlinfo(file)).toMatch(/Intensity target: 10000\.0+ nits/);
    const { rgb } = readPfm(djxl(file, 'pfm'));
    expect(rgb).toEqual(
      Float32Array.from({ length: rgb.length }, (_, i) => image.data[Math.floor(i / 3) * 4 + (i % 3)]),
    );
    // Lossy XYB is absolute: djxl must decode the same linear values as readJxl.
    const lossy = encode({ ...pattern(32, 32), metadata: { linearReferenceWhiteNits: 10000 } }, { lossy: true });
    expect(jxlinfo(lossy)).toMatch(/Intensity target: 10000\.0+ nits/);
    const djxlLossy = readPfm(djxl(lossy, 'pfm')).rgb;
    const ours = readJxl(fs.readFileSync(lossy)).data;
    for (let i = 0; i < djxlLossy.length; i++)
      expect(djxlLossy[i]).toBeCloseTo(ours[Math.floor(i / 3) * 4 + (i % 3)], 3);
  });

  for (const transferFunction of ['srgb', 'pq', 'hlg'] as const) {
    for (const bitDepth of ['uint8', 'uint16'] as const) {
      it(`${bitDepth} ${transferFunction} decodes in djxl to the encoded reference`, () => {
        const image = greyRamp(1000);
        const file = encode(image, { bitDepth, transferFunction });
        expect(jxlinfo(file)).toMatch(
          new RegExp(`Transfer function: ${transferFunction === 'srgb' ? 'sRGB' : transferFunction.toUpperCase()}`),
        );
        const { rgb } = readPfm(djxl(file, 'pfm'));
        const tol = 0.5 / (bitDepth === 'uint8' ? 255 : 65535) + 1e-6;
        for (let i = 0; i < image.width; i++) {
          expect(Math.abs(rgb[i * 3] - TRANSFER_REFERENCE[transferFunction](image.data[i * 4]))).toBeLessThanOrEqual(
            tol,
          );
        }
      });
    }
  }

  it('declares the transfer function on lossy output, which djxl decodes the same as readJxl', () => {
    const image = { ...pattern(32, 32), metadata: { linearReferenceWhiteNits: 1000 } };
    const file = encode(image, { lossy: true, transferFunction: 'pq' });
    expect(jxlinfo(file)).toMatch(/Transfer function: PQ/);
    const ours = readJxl(fs.readFileSync(file)).data;
    const { rgb } = readPfm(djxl(file, 'pfm'));
    for (let i = 0; i < rgb.length; i++)
      expect(rgb[i]).toBeCloseTo(nitsToPq(ours[Math.floor(i / 3) * 4 + (i % 3)] * 1000), 3);
  });

  it('large groups (groupSizeShift 3)', () => expectRgb(pattern(300, 40), { groupSizeShift: 3 }));

  it('high-effort ANS round trips with djxl for every sample format and partial groups', () => {
    for (const bitDepth of ['float16', 'float32', 'uint8', 'uint16'] as const) {
      expectRgb(
        pattern(270, 23, (x, y) => ((x + y) % 7) / 6),
        { bitDepth, effort: 'high', groupSizeShift: 0, transferFunction: 'linear' },
      );
    }
  });

  it('learned offsets and multipliers on the smooth corpus remain bit-exact in djxl', () => {
    const image = readExr(fs.readFileSync(new URL('../../../../assets/reference_gradient.exr', import.meta.url)));
    expectRgb(image, { effort: 'high' });
  });

  it('learned high-effort trees preserve float32 signs, extremes and partial-group state in djxl', () => {
    const extremes = [-0, -1e-45, 1e-45, 3.4e38, -3.4e38, -65504, 0.5];
    const image = makeImage(270, 23, (x, y, c) =>
      c === 3 ? ((x + y) % 7) / 6 : extremes[(x * 13 + y * 7 + c) % extremes.length],
    );
    expectRgb(image, { bitDepth: 'float32', effort: 'high', sanitize: false, groupSizeShift: 0 });
  });

  it('constant images', () => {
    expectRgb(
      makeImage(40, 30, () => 0),
      { bitDepth: 'float32' },
    );
    expectRgb(
      makeImage(40, 30, () => 1),
      { bitDepth: 'float32' },
    );
    expectRgb(makeImage(300, 9, (_x, _y, c) => [0.25, 3, 1000, 1][c]));
  });

  it('HDR values, tiny values and denormals', () => {
    const values = [0, 1e-45, 1e-40, 1.2e-38, 6e-8, 1e-5, 6.1e-5, 0.5, 1, 1.5, 100, 65504, 1e6, 3.4e38];
    const image = makeImage(values.length, 3, (x, y, c) => values[(x + y + c) % values.length]);
    expectRgb(image, { bitDepth: 'float32' });
    expectRgb(makeImage(values.length, 3, (x, y, c) => Math.min(65504, values[(x + y + c) % values.length])));
  });

  it('negative values survive with sanitize: false (float32 and float16)', () => {
    const image = (): HdrifyImage => makeImage(33, 9, (x, y, c) => (c === 3 ? 1 : (x - 16) * 1e3 ** ((y % 5) - 2)));
    expectRgb(image(), { bitDepth: 'float32', sanitize: false });
    expectRgb(image(), { bitDepth: 'float16', sanitize: false });
  });

  it('float32 RCT with int32 wrap-around (grey image with extreme mixed-sign pixels)', () => {
    const extremes = [3.4e38, -3.4e38, -1e-45, 1e-45, -0, 65504];
    const image = makeImage(40, 21, (x, y, c) => {
      if (c === 3) return 1;
      if ((x * 7 + y) % 13 === 0) return extremes[(x + y + c) % extremes.length];
      return (x + y) / 8; // grey: RCT is chosen
    });
    expectRgb(image, { bitDepth: 'float32', sanitize: false });
    expectRgb(image, { bitDepth: 'float16', sanitize: false });
  });

  it('channel palettes: few distinct values spread over a wide range, multi-group, with alpha', () => {
    // RGBE-like data: 8-bit mantissas with a shared exponent, as read from Radiance .hdr files.
    const rgbe = (x: number, y: number, c: number): number =>
      c === 3 ? ((x >> 4) & 3) / 3 : ((((x * (c + 1) + y * 3) % 128) + 128) / 256) * 2 ** (((x + y) >> 5) - 4);
    for (const bitDepth of ['float32', 'float16'] as const) {
      const image = makeImage(300, 70, rgbe);
      expectRgb(image, { bitDepth });
      const grey = makeImage(300, 70, (x, y, c) => rgbe(x, y, c === 3 ? 3 : 0));
      expectRgb(grey, { bitDepth });
    }
  });

  it('sanitizes negatives and non-finite values to 0 by default', () => {
    const image = makeImage(4, 2, (x, _y, c) => (c === 3 ? 1 : [-1, Number.NaN, Number.POSITIVE_INFINITY, 2][x]));
    expectRgb(image, { bitDepth: 'float32' });
    expect(Array.from(image.data.subarray(0, 4))).toEqual([0, 0, 0, 1]);
  });

  it('uint8 and uint16', () => {
    expectRgb(pattern(37, 11), { bitDepth: 'uint16', transferFunction: 'linear' });
    expectRgb(pattern(37, 11), { bitDepth: 'uint8', transferFunction: 'linear' });
  });

  for (const [space, primaries] of [
    ['linear-rec709', /Primaries: sRGB/],
    ['linear-p3', /Primaries: P3/],
    ['linear-rec2020', /Primaries: Rec\.2100/],
  ] as const) {
    it(`${space} reports linear transfer and its primaries`, () => {
      const image = pattern(5, 4);
      image.linearColorSpace = space;
      const file = encode(image);
      const info = jxlinfo(file);
      expect(info).toMatch(primaries);
      expect(info).toMatch(/White point: D65\nPrimaries: .*\nTransfer function: Linear/);
      expect(info).toMatch(/16-bit float \(5 exponent bits\) RGB\n/);
      expect(info).not.toMatch(/alpha/i);
      expectRgb(image);
    });
  }

  for (const bitDepth of ['float32', 'float16'] as const) {
    it(`${bitDepth} alpha channel round-trips (single and multi group)`, () => {
      for (const [w, h] of [
        [9, 7],
        [270, 20],
      ] as const) {
        const image = pattern(w, h, (x, y) => ((x * 7 + y * 3) % 11) / 10);
        const file = encode(image, { bitDepth });
        expect(jxlinfo(file)).toMatch(/alpha/i);
        // djxl's EXR output is half float with premultiplied colour: check alpha exactly there,
        // and the (straight) colour exactly through PFM.
        const decoded = decodeExr(file);
        for (let i = 0; i < w * h; i++) {
          expect(decoded.data[i * 4 + 3]).toBe(expected(image.data[i * 4 + 3], 'float16'));
        }
        expectRgb(image, { bitDepth });
      }
    });
  }

  it('alpha option forces or suppresses the alpha channel', () => {
    expect(jxlinfo(encode(pattern(3, 3), { alpha: true }))).toMatch(/alpha/i);
    expect(
      jxlinfo(
        encode(
          pattern(3, 3, () => 0.5),
          { alpha: false },
        ),
      ),
    ).not.toMatch(/alpha/i);
  });

  it('container output decodes and has the box structure', () => {
    const image = pattern(20, 10);
    const bytes = writeJxl(image, { container: true });
    expect(Array.from(bytes.subarray(0, 12))).toEqual([0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]);
    expect(new TextDecoder().decode(bytes.subarray(16, 20))).toBe('ftyp');
    expect(new TextDecoder().decode(bytes.subarray(36, 40))).toBe('jxlc');
    expect(Array.from(bytes.subarray(40, 42))).toEqual([0xff, 0x0a]);
    expect(jxlinfo(encode(image, { container: true }))).toMatch(/container/i);
    expectRgb(image, { container: true });
  });
});

describe('writeJxl', () => {
  it('writes a bare codestream by default', () => {
    expect(Array.from(writeJxl(pattern(2, 2)).subarray(0, 2))).toEqual([0xff, 0x0a]);
  });

  it('compresses flat and smooth synthetic images below their previous size', () => {
    const flat = makeImage(256, 256, (x, _y, c) => (c === 3 ? 1 : x < 128 ? 0 : [0.25, 3, 1000][c]));
    const encoded = writeJxl(flat);
    expect(encoded.length).toBeLessThan(512);
    const decoded = readJxl(encoded);
    expect(decoded.data).toEqual(flat.data);
    const smooth = makeImage(512, 512, (x, y, c) => (c === 3 ? 1 : (x + y * (c + 1)) / 1024));
    const bytes = writeJxl(smooth);
    expect(bytes.length).toBeLessThan(60000);
    const got = readJxl(bytes);
    expect(got.data).toEqual(Float32Array.from(smooth.data, (v) => expected(v, 'float16')));
  });

  for (const bitDepth of ['float16', 'float32', 'uint8', 'uint16'] as const) {
    it(`${bitDepth}: prediction and LZ77 retain samples across partial groups and alpha`, () => {
      const image = pattern(270, 23, (x, y) => ((x + y) % 7) / 6);
      const decoded = readJxl(writeJxl(image, { bitDepth, groupSizeShift: 0, transferFunction: 'linear' }));
      expect([decoded.width, decoded.height]).toEqual([image.width, image.height]);
      for (let i = 0; i < image.data.length; i++) {
        expect(decoded.data[i]).toBeCloseTo(expected(image.data[i], bitDepth), 6);
      }
    });
  }

  it('weighted prediction compresses the gradient corpus without changing half-float samples', () => {
    const image = readExr(fs.readFileSync(new URL('../../../../assets/reference_gradient.exr', import.meta.url)));
    const bytes = writeJxl(image);
    expect(bytes.length).toBeLessThan(56000); // Gradient + LZ77 alone was 62,906 bytes.
    const got = readJxl(bytes);
    expect(got.data).toEqual(Float32Array.from(image.data, (v) => decodeFloat16(encodeFloat16(v))));
  });

  it('chooses a dense palette by cost and keeps integer samples exact', () => {
    let seed = 12345;
    const image = makeImage(64, 64, (_x, _y, c) => {
      if (c === 3) return 1;
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (((seed >>> 0) % 100) * 2) / 255;
    });
    const bytes = writeJxl(image, { bitDepth: 'uint8', transferFunction: 'linear' });
    expect(bytes.length).toBeLessThan(12000); // The fixed density threshold produced 12,878 bytes.
    expect(readJxl(bytes).data).toEqual(image.data);
  });

  it('high effort enables size-gated ANS while standard output remains the default', () => {
    const image = readExr(fs.readFileSync(new URL('../../../../assets/reference_gradient.exr', import.meta.url)));
    const standard = writeJxl(image);
    expect(writeJxl(image, { effort: 'standard' })).toEqual(standard);
    const high = writeJxl(image, { effort: 'high' });
    expect(high.length).toBeLessThan(standard.length);
    expect(readJxl(high).data).toEqual(readJxl(standard).data);
  });

  // Full-corpus tree search exceeds 30 seconds under coverage on two-core CI runners.
  it('learned high-effort contexts reduce memorial without changing samples or standard output', () => {
    const image = readExr(fs.readFileSync(new URL('../../../../assets/memorial.exr', import.meta.url)));
    const high = writeJxl(image, { effort: 'high' });
    expect(high.length).toBeLessThan(920000); // ANS without learned contexts was 949,906 bytes.
    expect(readJxl(high).data).toEqual(readJxl(writeJxl(image)).data);
    expect(writeJxl(pattern(7, 5), { effort: 'high' })).toEqual(writeJxl(pattern(7, 5), { effort: 'high' }));
  }, 90_000);

  it('high-effort float32 output keeps every source bit through the public decoder', () => {
    const values = [-0, -1e-45, 1e-45, 3.4e38, -3.4e38, -65504, 0.5];
    const image = makeImage(270, 23, (x, y, c) => (c === 3 ? 1 : values[(x * 13 + y * 7 + c) % values.length]));
    const decoded = readJxl(
      writeJxl(image, { bitDepth: 'float32', effort: 'high', sanitize: false, groupSizeShift: 0 }),
    );
    expect(new Uint32Array(decoded.data.buffer)).toEqual(new Uint32Array(image.data.buffer));
  });

  for (const name of ['pq-d0.jxl', 'pq-d1.jxl', 'hlg-d0.jxl']) {
    it(`${name}: lossless round trip keeps the intensity target and samples`, () => {
      const image = readColorAsset(name);
      const nits = image.metadata?.linearReferenceWhiteNits;
      expect(nits).not.toBe(255);
      const decoded = readJxl(writeJxl(image, { bitDepth: 'float32' }));
      expect(decoded.metadata?.linearReferenceWhiteNits).toBe(nits);
      expect(new Uint32Array(decoded.data.buffer)).toEqual(new Uint32Array(image.data.buffer));
    });
  }

  it('lossy output keeps the intensity target and absolute brightness', () => {
    const image = { ...pattern(32, 32), metadata: { linearReferenceWhiteNits: 4000 } };
    const decoded = readJxl(writeJxl(image, { lossy: true, distance: 0.1 }));
    expect(decoded.metadata?.linearReferenceWhiteNits).toBe(4000);
    let sum = 0;
    let want = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      sum += decoded.data[i + 1];
      want += image.data[i + 1];
    }
    expect(sum / want).toBeCloseTo(1, 2);
  });

  for (const transferFunction of ['linear', 'srgb', 'pq', 'hlg'] as const) {
    for (const bitDepth of ['uint8', 'uint16', 'float32'] as const) {
      it(`${bitDepth} ${transferFunction} round trips through readJxl within quantization error`, () => {
        const image = greyRamp(1000);
        const decoded = readJxl(writeJxl(image, { bitDepth, transferFunction }));
        const ref = transferFunction === 'linear' ? (v: number) => v : TRANSFER_REFERENCE[transferFunction];
        const tol = (bitDepth === 'uint8' ? 0.5 / 255 : bitDepth === 'uint16' ? 0.5 / 65535 : 0) + 1e-5;
        for (let i = 0; i < decoded.data.length; i++) {
          if (i % 4 === 3) continue;
          expect(Math.abs(ref(decoded.data[i]) - ref(image.data[i]))).toBeLessThanOrEqual(tol);
        }
      });
    }
  }

  it('uint8 defaults to sRGB, banding no worse than an 8-bit sRGB PNG', () => {
    const image = greyRamp(4096);
    const srgbError = (options: WriteJxlOptions): number => {
      const decoded = readJxl(writeJxl(image, options)).data;
      let max = 0;
      for (let i = 0; i < decoded.length; i += 4) {
        const png = Math.round(linearTosRGB(image.data[i]) * 255) / 255; // 8-bit sRGB PNG sample
        max = Math.max(max, Math.abs(linearTosRGB(decoded[i]) - png));
      }
      return max;
    };
    expect(srgbError({ bitDepth: 'uint8' })).toBeLessThan(1e-5);
    expect(srgbError({ bitDepth: 'uint8', transferFunction: 'linear' })).toBeGreaterThan(5 / 255); // linear 8-bit: 6 codes off in the shadows
    expect(readJxl(writeJxl(image)).metadata?.transferFunction).toBe('linear');
  });

  it('lossy uint8 sRGB pre-quantizes on the sRGB grid, without linear shadow banding', () => {
    const image = greyRamp(1024);
    const shadowError = (options: WriteJxlOptions): number => {
      const decoded = readJxl(writeJxl(image, { lossy: true, distance: 0.1, bitDepth: 'uint8', ...options })).data;
      let max = 0;
      for (let i = 0; i < decoded.length && image.data[i] < 0.05; i += 4)
        max = Math.max(max, Math.abs(linearTosRGB(decoded[i]) - linearTosRGB(image.data[i])));
      return max;
    };
    const srgb = shadowError({});
    const lossless = readJxl(writeJxl(image, { bitDepth: 'uint8' })).data;
    let losslessError = 0;
    for (let i = 0; i < lossless.length && image.data[i] < 0.05; i += 4)
      losslessError = Math.max(losslessError, Math.abs(linearTosRGB(lossless[i]) - linearTosRGB(image.data[i])));
    expect(srgb).toBeLessThan(losslessError + 2 / 255); // distance 0.1 error on top of the 0.5-code grid
    expect(shadowError({ transferFunction: 'linear' })).toBeGreaterThan(5 / 255);
  });

  it('defaults the intensity target to 255 nits and validates it', () => {
    expect(readJxl(writeJxl(pattern(2, 2))).metadata?.linearReferenceWhiteNits).toBe(255);
    const bad = { ...pattern(2, 2), metadata: { linearReferenceWhiteNits: 1e6 } };
    expect(() => writeJxl(bad)).toThrow(/linearReferenceWhiteNits/);
  });

  it('rejects invalid input', () => {
    const ok = pattern(2, 2);
    expect(() => writeJxl({ ...ok, width: 0 })).toThrow(/dimensions/);
    expect(() => writeJxl({ ...ok, height: -1 })).toThrow(/dimensions/);
    expect(() => writeJxl({ ...ok, width: 1.5 })).toThrow(/dimensions/);
    expect(() => writeJxl({ ...ok, data: new Float32Array(15) })).toThrow(/length/);
    expect(() => writeJxl(ok, { groupSizeShift: 4 })).toThrow(/groupSizeShift/);
    expect(() => writeJxl(ok, { effort: 'invalid' as 'high' })).toThrow(/effort/);
    expect(() => writeJxl(ok, { lossy: true, effort: 'high' })).toThrow(/only supported for lossless/);
    expect(() => writeJxl(ok, { lossy: true, effort: 'standard' })).not.toThrow();
    expect(() => writeJxl(ok, { bitDepth: 'int7' as 'uint8' })).toThrow(/bitDepth/);
    expect(() => writeJxl(ok, { transferFunction: 'gamma' as 'srgb' })).toThrow(/transferFunction/);
  });
});
