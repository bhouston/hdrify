import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeFloat16, encodeFloat16 } from '../exr/halfFloat.js';
import { readExr } from '../exr/readExr.js';
import type { HdrifyImage } from '../hdrifyImage.js';
import { ASSETS } from './jxlTestAssets.js';
import { type JxlExtraChannel, readJxl } from './readJxl.js';
import { type WriteJxlOptions, writeJxl } from './writeJxl.js';

const hasDjxl = spawnSync('djxl', ['--version']).status === 0;
const COLOR_ASSETS = new URL('../../../../assets/jxl/color/', import.meta.url);
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

/** Parse a PFM (bottom-to-top rows; grey `Pf` is repeated into RGB) into top-to-bottom interleaved RGB. */
function readPfm(buf: Uint8Array): { width: number; height: number; rgb: Float32Array } {
  const text = new TextDecoder('latin1').decode(buf.subarray(0, 64));
  const m = /^P([Ff])\s+(\d+)\s+(\d+)\s+(-?[\d.]+)\s/.exec(text);
  if (!m) throw new Error('bad PFM');
  const [nc, width, height, scale] = [m[1] === 'F' ? 3 : 1, Number(m[2]), Number(m[3]), Number(m[4])];
  const dv = new DataView(buf.buffer, buf.byteOffset + m[0].length);
  const rgb = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < width * 3; i++) {
      const src = nc === 3 ? i : Math.floor(i / 3);
      rgb[(height - 1 - y) * width * 3 + i] = dv.getFloat32((y * width * nc + src) * 4, scale < 0);
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

  it('large groups (groupSizeShift 3)', () => expectRgb(pattern(300, 40), { groupSizeShift: 3 }));

  it('high-effort ANS round trips with djxl for every sample format and partial groups', () => {
    for (const bitDepth of ['float16', 'float32', 'uint8', 'uint16'] as const) {
      expectRgb(
        pattern(270, 23, (x, y) => ((x + y) % 7) / 6),
        { bitDepth, effort: 'high', groupSizeShift: 0 },
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
    expectRgb(image, { bitDepth: 'float32', sanitize: false, grayscale: false });
    expectRgb(image, { bitDepth: 'float16', sanitize: false, grayscale: false });
    expectRgb(image, { bitDepth: 'float32', sanitize: false });
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
    expectRgb(pattern(37, 11), { bitDepth: 'uint16' });
    expectRgb(pattern(37, 11), { bitDepth: 'uint8' });
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

const fixture = (name: string): Uint8Array => fs.readFileSync(new URL(`features/${name}.jxl`, ASSETS));
function expectSame(a: HdrifyImage, b: HdrifyImage): void {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  expect(firstMismatch(a.data, b.data, 0)).toBe('none');
  const ecs = (img: HdrifyImage) =>
    (img.metadata?.extraChannels as JxlExtraChannel[] | undefined)?.map((ec) => ({
      ...ec,
      data: Array.from(ec.data),
    }));
  expect(ecs(a)).toEqual(ecs(b));
}

describe.skipIf(!hasDjxl)('writeJxl channels and orientation match libjxl djxl', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdrify-jxl-ch-'));
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  /** djxl PFM output, plus one PFM per extra channel, as raw bytes. */
  function djxlFiles(bytes: Uint8Array, name: string): Buffer[] {
    const file = path.join(dir, `${name}.jxl`);
    fs.writeFileSync(file, bytes);
    const r = spawnSync('djxl', [file, `${file}.pfm`, '--output_extra_channels'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`djxl failed: ${r.stderr}`);
    const outputs = fs.readdirSync(dir).filter((f) => f.startsWith(`${name}.jxl`) && f.endsWith('.pfm'));
    return outputs.toSorted().map((f) => fs.readFileSync(path.join(dir, f)));
  }
  for (let orientation = 1; orientation <= 8; orientation++) {
    it(`orientation ${orientation} round-trips through readJxl and djxl`, () => {
      const source = fixture(`orientation${orientation}`);
      const stored = readJxl(source, { applyOrientation: false });
      const bytes = writeJxl(stored, { orientation, bitDepth: 'float32' });
      expectSame(readJxl(bytes), readJxl(source));
      expect(readJxl(bytes).metadata?.orientation).toBe(orientation);
      expect(djxlFiles(bytes, `o${orientation}`)).toEqual(djxlFiles(source, `o${orientation}-ref`));
    });
  }

  for (const lossy of [false, true]) {
    for (const name of ['extra_channels', 'spot_color']) {
      it(`${name} extra channels round-trip (${lossy ? 'lossy' : 'lossless'})`, () => {
        const source = fixture(name);
        const image = readJxl(source);
        const extraChannels = image.metadata?.extraChannels as JxlExtraChannel[];
        const bytes = writeJxl(image, { bitDepth: 'float32', extraChannels, lossy });
        // metadata.extraChannels is the default.
        expect(Buffer.from(writeJxl(image, { bitDepth: 'float32', lossy }))).toEqual(Buffer.from(bytes));
        const decoded = readJxl(bytes);
        const ecs = decoded.metadata?.extraChannels as JxlExtraChannel[];
        const info = (ec: JxlExtraChannel) => [ec.name, ec.type, ec.spotColor];
        expect(ecs.map(info)).toEqual(extraChannels.map(info));
        for (let i = 0; i < ecs.length; i++) expect(firstMismatch(ecs[i].data, extraChannels[i].data, 0)).toBe('none');
        const [, ...decodedEcs] = djxlFiles(bytes, `${name}-${lossy}`);
        const [, ...referenceEcs] = djxlFiles(source, `${name}-${lossy}-ref`);
        expect(decodedEcs).toEqual(referenceEcs);
        if (!lossy) {
          expectSame(decoded, image);
          expect(djxlFiles(bytes, `${name}-again`)).toEqual(djxlFiles(source, `${name}-again-ref`));
        }
      });
    }
  }

  it('alphaPremultiplied writes associated alpha', () => {
    const source = fixture('associated_alpha');
    const premultiplied = readJxl(source, { keepPremultipliedAlpha: true });
    const bytes = writeJxl(premultiplied, { bitDepth: 'float32' }); // metadata.alphaPremultiplied
    expect(Buffer.from(writeJxl(premultiplied, { bitDepth: 'float32', alphaPremultiplied: true }))).toEqual(
      Buffer.from(bytes),
    );
    expectSame(readJxl(bytes), readJxl(source));
    expectSame(readJxl(bytes, { keepPremultipliedAlpha: true }), premultiplied);
    expect(readJxl(bytes, { keepPremultipliedAlpha: true }).metadata?.alphaPremultiplied).toBe(true);
    expect(djxlFiles(bytes, 'assoc')).toEqual(djxlFiles(source, 'assoc-ref'));
  });

  it('grayscale writes one colour channel, smaller than RGB', () => {
    const grey = pattern(300, 260, (x, y) => ((x + y) % 5) / 4);
    for (let i = 0; i < grey.data.length; i += 4) grey.data[i + 1] = grey.data[i + 2] = grey.data[i]!;
    const rgb = writeJxl(grey, { grayscale: false });
    const auto = writeJxl(grey, { grayscale: 'auto' });
    expect(auto.length).toBeLessThan(rgb.length);
    expect(readJxl(auto).metadata?.colorSpace).toBe('gray');
    expectSame(readJxl(auto), readJxl(rgb));
    expect(Buffer.from(writeJxl(grey, { grayscale: true }))).toEqual(Buffer.from(auto));
    expect(readJxl(writeJxl(pattern(5, 5), { grayscale: 'auto' })).metadata?.colorSpace).toBe('rgb');
    const file = path.join(dir, 'grey.jxl');
    fs.writeFileSync(file, auto);
    expect(spawnSync('jxlinfo', [file], { encoding: 'utf8' }).stdout).toMatch(/Grayscale/);
    const [greyPfm] = djxlFiles(auto, 'grey');
    const [rgbPfm] = djxlFiles(rgb, 'grey-rgb');
    expect(greyPfm!.subarray(0, 2).toString()).toBe('Pf');
    expect(firstMismatch(readPfm(greyPfm).rgb, readPfm(rgbPfm).rgb, 0)).toBe('none');
    const lossy = writeJxl(grey, { grayscale: true, lossy: true, bitDepth: 'float32' });
    const lossyRgb = writeJxl(grey, { lossy: true, bitDepth: 'float32', grayscale: false });
    expect(readJxl(lossy).metadata?.colorSpace).toBe('gray');
    expect(firstMismatch(readJxl(lossy).data, readJxl(lossyRgb).data, 1e-6)).toBe('none');
    const [lossyPfm] = djxlFiles(lossy, 'grey-lossy');
    expect(firstMismatch(readPfm(lossyPfm).rgb, readPfm(djxlFiles(lossyRgb, 'rgb-lossy')[0]).rgb, 1e-3)).toBe('none');
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
      const decoded = readJxl(writeJxl(image, { bitDepth, groupSizeShift: 0 }));
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
    const bytes = writeJxl(image, { bitDepth: 'uint8' });
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
  });
});
