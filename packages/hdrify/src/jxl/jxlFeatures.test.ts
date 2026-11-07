import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JxlBitReader } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import { JxlEncEntropyCode, packSigned } from './jxlEncEntropy.js';
import { writeToc } from './jxlEncHeaders.js';
import { extractCodestream } from './jxlContainer.js';
import {
  applyPatches,
  catmullRomPoints,
  continuousIdct,
  convolveNoise,
  dequantizeSpline,
  drawSplines,
  equallySpacedPoints,
  fastCos,
  fastErf,
  JxlXorshift128Plus,
  noiseStrength,
  randomNoisePlanes,
  readNoiseParams,
  readPatches,
  readSplines,
  renderNoise,
  type JxlPatch,
  type JxlSplines,
} from './jxlFeatures.js';
import { type JxlFrameHeader, readFrameHeader, readToc } from './jxlFrameHeader.js';
import { type JxlExtraChannelInfo, type JxlImageHeader, readImageHeader } from './jxlImageHeader.js';
import {
  type JxlReferenceFrame,
  PATCH_ADD,
  PATCH_BLEND_ABOVE,
  PATCH_MUL,
  PATCH_NONE,
  PATCH_REPLACE,
} from './jxlRender.js';
import { ASSETS, readPfm } from './jxlTestAssets.js';
import { decodeFrame } from './readJxl.js';
import { writeJxl } from './writeJxl.js';

const asset = (name: string) => new Uint8Array(fs.readFileSync(new URL(`features/${name}`, ASSETS)));

/** A real (non-XYB, linear RGB) image header, with overrides. */
function imageHeader(overrides: Partial<JxlImageHeader> = {}): JxlImageHeader {
  const img = { width: 4, height: 4, data: new Float32Array(64), linearColorSpace: 'linear-rec709' as const };
  return { ...readImageHeader(new JxlBitReader(writeJxl(img))), ...overrides };
}

/** An all_default frame header for `image`, with overrides. */
function frameHeader(image: JxlImageHeader, overrides: Partial<JxlFrameHeader> = {}): JxlFrameHeader {
  return { ...readFrameHeader(new JxlBitReader(new Uint8Array([1])), image), ...overrides };
}

const alphaInfo = (alphaAssociated = false): JxlExtraChannelInfo => ({
  type: 'alpha',
  bitDepth: { floatSample: false, bitsPerSample: 8, expBits: 0 },
  dimShift: 0,
  name: '',
  alphaAssociated,
});

/** Entropy-code (ctx, value) symbols with the test prefix-code encoder. */
function writeSymbols(w: JxlBitWriter, numContexts: number, symbols: [number, number][]): void {
  const stream = { contexts: symbols.map((s) => s[0]), values: symbols.map((s) => s[1]) };
  const code = JxlEncEntropyCode.build(numContexts, [stream]);
  code.writeHeader(w);
  code.writeStream(w, stream);
}

function readerFor(write: (w: JxlBitWriter) => void): JxlBitReader {
  const w = new JxlBitWriter();
  write(w);
  w.writeBits(8, 0xa5); // marker: the parser must stop exactly before it
  return new JxlBitReader(w.finish());
}

// ---------------------------------------------------------------------------------------------
// Noise

/** Reference Xorshift128+ in BigInt (straight from xorshift128plus-inl.h). */
function bigintXorshift(s0: bigint[], s1: bigint[]): bigint[] {
  const M = (1n << 64n) - 1n;
  const out: bigint[] = [];
  for (let i = 0; i < 8; i++) {
    let a = s0[i];
    const b = s1[i];
    out.push((a + b) & M);
    s0[i] = b;
    a ^= (a << 23n) & M;
    s1[i] = a ^ b ^ (a >> 18n) ^ (b >> 5n);
  }
  return out;
}

const lanes = (u: Uint32Array) => Array.from({ length: 8 }, (_, i) => (BigInt(u[2 * i + 1]) << 32n) | BigInt(u[2 * i]));

describe('JxlXorshift128Plus', () => {
  it('matches the libjxl golden values (xorshift128plus_test.cc, seed 12345)', () => {
    const expected = [
      [
        0x6e901576d477cbb1n,
        0xe9e53789195da2a2n,
        0xb681f6dda5e0ae99n,
        0x8efd18ce21fd6896n,
        0xa898a80df75cf532n,
        0x50ceb2c9e2de7e32n,
        0x3ca7c2feb25c0dd0n,
        0xa4d0866b80b4d836n,
      ],
      [
        0x8cd6a1e6233d3a26n,
        0x3d4603ade98b112dn,
        0xdc427af674019e36n,
        0xe28b4d230705ac53n,
        0x7297e9bba88783ddn,
        0x34d3d23cfcd9b41an,
        0x5a223615adbe96b8n,
        0xe5eb529027cfbd01n,
      ],
      [
        0xc1894cf00dfac6a2n,
        0x18edf8ae9085e404n,
        0x8e936625296b4ccdn,
        0x31971ef3a14a899bn,
        0xbe87535fce0bf26an,
        0x576f7a752bc6649fn,
        0xa44cbadce0c6b937n,
        0x3dba819bb17a353an,
      ],
    ];
    const rng = new JxlXorshift128Plus(12345);
    const out = new Uint32Array(16);
    for (const row of expected) {
      rng.next(out);
      expect(lanes(out)).toEqual(row);
    }
  });

  it('4-seed form agrees with a BigInt reference over many iterations', () => {
    const M = (1n << 64n) - 1n;
    const sm = (z: bigint) => {
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M;
      return z ^ (z >> 31n);
    };
    const g = 0x9e3779b97f4a7c15n;
    const s0 = [sm(((3n << 32n) + 7n + g) & M)];
    const s1 = [sm(((256n << 32n) + 512n + g) & M)];
    for (let i = 1; i < 8; i++) {
      s0.push(sm(s0[i - 1]));
      s1.push(sm(s1[i - 1]));
    }
    const rng = new JxlXorshift128Plus(3, 7, 256, 512);
    const out = new Uint32Array(16);
    for (let k = 0; k < 200; k++) {
      rng.next(out);
      expect(lanes(out)).toEqual(bigintXorshift(s0, s1));
    }
  });
});

describe('noise building blocks', () => {
  it('readNoiseParams reads 8 x u(10) / 1024', () => {
    const vals = [0, 1, 512, 1023, 7, 100, 900, 33];
    const br = readerFor((w) => vals.forEach((v) => w.writeBits(10, v)));
    expect(Array.from(readNoiseParams(br))).toEqual(vals.map((v) => v / 1024));
    expect(br.readBits(8)).toBe(0xa5);
  });

  it('noiseStrength interpolates the LUT over 6 intervals and clamps', () => {
    const lut = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9]);
    expect(noiseStrength(lut, -1)).toBeCloseTo(0.1, 6);
    expect(noiseStrength(lut, 0)).toBeCloseTo(0.1, 6);
    expect(noiseStrength(lut, 1 / 6)).toBeCloseTo(0.2, 6);
    expect(noiseStrength(lut, 0.25)).toBeCloseTo(0.25, 6);
    expect(noiseStrength(lut, 1)).toBeCloseTo(0.7, 6);
    expect(noiseStrength(lut, 13 / 12)).toBeCloseTo(0.8, 6); // between lut[6] and lut[7]
    expect(noiseStrength(lut, 5)).toBeCloseTo(0.9, 6); // >= 7/6: lut[7]
    expect(noiseStrength(new Float32Array(8).fill(1023 / 1024 + 0.5), 0.5)).toBe(1); // clamped
  });

  it('convolveNoise: constant → 0, impulse → 4 * (1 - box5x5), mirrored borders', () => {
    const flat = convolveNoise(new Float32Array(49).fill(1.5), 7, 7);
    for (const v of flat) expect(Math.abs(v)).toBeLessThan(1e-6);
    const imp = new Float32Array(81);
    imp[40] = 1;
    const out = convolveNoise(imp, 9, 9);
    expect(out[40]).toBeCloseTo(-3.84, 6);
    expect(out[40 + 2 * 9 + 2]).toBeCloseTo(0.16, 6);
    expect(out[40 + 3]).toBe(0);
    // Mirror: a corner impulse is seen twice by its mirrored neighbour at x=-1 (→ 0).
    const corner = new Float32Array(25);
    corner[0] = 1;
    const c = convolveNoise(corner, 5, 5);
    expect(c[0]).toBeCloseTo(-3.84 + 3 * 0.16, 6); // (x,y) ∈ {-1,0}² mirrors onto (0,0): 3 extra hits
    expect(c[1]).toBeCloseTo(2 * 0.16 * 2, 6); // rows -1,0 and columns -1,0 → 4 hits
  });

  it('randomNoisePlanes seeds each group tile and fills rows in batches of 16 floats', () => {
    const [p0, p1] = randomNoisePlanes(150, 3, 128, 2, 5);
    for (const v of p0) expect(v >= 1 && v < 2).toBe(true);
    // Tile (128, 0): 22 x 3, planes generated sequentially from one RNG.
    const rng = new JxlXorshift128Plus(2, 5, 128, 0);
    const bits = new Uint32Array(16);
    const f = new Float32Array(1);
    const u = new Uint32Array(f.buffer);
    const toF = (b: number) => {
      u[0] = (b >>> 9) | 0x3f800000;
      return f[0];
    };
    const expectRow = (plane: Float32Array, y: number) => {
      rng.next(bits);
      for (let i = 0; i < 16; i++) expect(plane[y * 150 + 128 + i]).toBe(toF(bits[i]));
      rng.next(bits);
      for (let i = 0; i < 6; i++) expect(plane[y * 150 + 144 + i]).toBe(toF(bits[i]));
    };
    for (let y = 0; y < 3; y++) expectRow(p0, y);
    for (let y = 0; y < 3; y++) expectRow(p1, y);
  });

  it('renderNoise is a no-op for an all-zero LUT', () => {
    const planes: [Float32Array, Float32Array, Float32Array] = [
      new Float32Array(16).fill(0.2),
      new Float32Array(16).fill(0.5),
      new Float32Array(16).fill(0.3),
    ];
    renderNoise(planes, 4, 4, new Float32Array(8), { visibleFrameIndex: 1, nonvisibleFrameIndex: 0, groupDim: 256 });
    expect(planes[1].every((v) => v === 0.5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Crafted oracles: a lossless float32 Modular frame (writeJxl) with noise / splines added to LfGlobal,
// decoded by djxl (scripts/generate-jxl-assets.sh). libjxl renders both on channels 0..2 whatever the
// color space, so the reference shows exactly the feature's contribution.

const FLAG_NOISE = 1;
const FLAG_SPLINES = 16;

function gradientImage(width: number, height: number) {
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (0.3 * x) / width;
      data[i + 1] = (2.4 * x) / width + (0.1 * y) / height;
      data[i + 2] = 0.5;
      data[i + 3] = 1;
    }
  }
  return { width, height, data, linearColorSpace: 'linear-rec709' as const };
}

/** writeJxl's single frame with `flags` set and `features` written at the start of LfGlobal. */
function craftFeatureJxl(
  img: ReturnType<typeof gradientImage>,
  groupSizeShift: number,
  flags: number,
  features: (w: JxlBitWriter) => void,
): Uint8Array {
  const src = writeJxl(img, { bitDepth: 'float32', alpha: false, groupSizeShift });
  const br = new JxlBitReader(src);
  const h = readImageHeader(br);
  const frameStart = br.byteOffset;
  const toc = readToc(br, readFrameHeader(br, h));
  const base = br.byteOffset;
  const w = new JxlBitWriter();
  w.writeBytes(src.subarray(0, frameStart));
  // FrameHeader as jxlEncHeaders.writeFrameHeader, with flags.
  w.writeBool(false);
  w.writeBits(2, 0); // regular
  w.writeBits(1, 1); // modular
  w.writeU64(flags);
  w.writeBool(false); // do_YCbCr
  w.writeU32(1, 1, 2, 4, 8); // upsampling
  w.writeBits(2, groupSizeShift);
  w.writeU32(1, 1, 2, 3, { bits: 3, offset: 4 }); // num_passes
  w.writeBool(false); // crop
  w.writeU32(0, 0, 1, 2, { bits: 2, offset: 3 }); // blend mode replace
  w.writeBool(true); // is_last
  w.writeU32(0, 0, { bits: 4, offset: 0 }, { bits: 5, offset: 16 }, { bits: 10, offset: 48 }); // name
  w.writeBool(false); // restoration: not all_default
  w.writeBool(false); // gab
  w.writeBits(2, 0); // epf
  w.writeU64(0);
  w.writeU64(0);
  const lf = new JxlBitWriter();
  features(lf);
  const old = new JxlBitReader(src, base + toc.offsets[0], toc.sizes[0]);
  for (let i = 0; i < toc.sizes[0] * 8; i++) lf.writeBits(1, old.readBits(1));
  const sections = [lf.finish()];
  for (let i = 1; i < toc.sizes.length; i++) {
    sections.push(src.subarray(base + toc.offsets[i], base + toc.offsets[i] + toc.sizes[i]));
  }
  writeToc(
    w,
    sections.map((s) => s.length),
  );
  for (const s of sections) w.writeBytes(s);
  return w.finish();
}

const NOISE_LUT = [102, 205, 307, 410, 512, 614, 717, 819];
const craftNoise = () =>
  craftFeatureJxl(gradientImage(140, 20), 0, FLAG_NOISE, (w) => NOISE_LUT.forEach((v) => w.writeBits(10, v)));

/** Splines in a 64x48 frame: two splines, one curved with varying color/sigma, one short and narrow. */
const SPLINE_SYMBOLS: [number, number][] = (() => {
  const s: [number, number][] = [[2, 1]]; // 2 splines
  s.push([1, 12], [1, 14]); // start (12, 14)
  s.push([1, packSigned(30)], [1, packSigned(20)]); // start (42, 34)
  s.push([0, packSigned(-1)]); // quant adjustment
  const dct = (vals: Record<number, number>) => {
    for (let i = 0; i < 32; i++) s.push([5, packSigned(vals[i] ?? 0)]);
  };
  s.push([3, 2], [4, packSigned(15)], [4, packSigned(5)], [4, packSigned(0)], [4, packSigned(-10)]);
  dct({ 0: 10, 3: -4 });
  dct({ 0: 4, 1: 2, 5: -1 });
  dct({ 0: 3 });
  dct({ 0: 6, 2: -1 });
  s.push([3, 1], [4, packSigned(8)], [4, packSigned(-3)]);
  dct({ 0: -6 });
  dct({ 0: -3, 7: 1 });
  dct({ 0: 1 });
  dct({ 0: 2 });
  return s;
})();
const craftSplines = () =>
  craftFeatureJxl(gradientImage(64, 48), 1, FLAG_SPLINES, (w) => writeSymbols(w, 6, SPLINE_SYMBOLS));

/** The source planes of gradientImage, as the decoder sees them. */
function sourcePlanes(img: ReturnType<typeof gradientImage>): [Float32Array, Float32Array, Float32Array] {
  const n = img.width * img.height;
  const p: [Float32Array, Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) p[c][i] = img.data[i * 4 + c]!;
  return p;
}

function maxDiff(planes: Float32Array[], ref: ReturnType<typeof readPfm>): number {
  let m = 0;
  for (let i = 0; i < ref.width * ref.height; i++) {
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(planes[c][i] - ref.samples[i * 3 + c]));
  }
  return m;
}

describe('crafted noise / spline oracles (djxl)', () => {
  it.runIf(process.env.JXL_CRAFT_OUT)('writes the crafted assets', () => {
    const out = process.env.JXL_CRAFT_OUT!;
    fs.writeFileSync(`${out}/noise_crafted.jxl`, craftNoise());
    fs.writeFileSync(`${out}/splines_crafted.jxl`, craftSplines());
  });

  it('the committed crafted assets are reproducible', () => {
    expect(craftNoise()).toEqual(asset('noise_crafted.jxl'));
    expect(craftSplines()).toEqual(asset('splines_crafted.jxl'));
  });

  it('renderNoise matches djxl (two 128-px groups, visible frame 1)', () => {
    const img = gradientImage(140, 20);
    const planes = sourcePlanes(img);
    const ref = readPfm('features/noise_crafted.ref.pfm');
    expect(maxDiff(planes, ref)).toBeGreaterThan(0.01); // noise is visible
    const params = new Float32Array(NOISE_LUT.map((v) => v / 1024));
    renderNoise(planes, 140, 20, params, { visibleFrameIndex: 1, nonvisibleFrameIndex: 0, groupDim: 128 });
    expect(maxDiff(planes, ref)).toBeLessThan(2e-5);
  });

  it('readSplines + drawSplines match djxl', () => {
    const file = craftSplines();
    const br = new JxlBitReader(file);
    const h = readImageHeader(br);
    const fh = readFrameHeader(br, h);
    expect(fh.splines).toBe(true);
    const toc = readToc(br, fh);
    const lf = new JxlBitReader(file, br.byteOffset + toc.offsets[0], toc.sizes[0]);
    const splines = readSplines(lf, fh);
    expect(splines.startingPoints).toEqual([
      [12, 14],
      [42, 34],
    ]);
    expect(splines.quantAdjustment).toBe(-1);
    expect(splines.splines[0].controlPoints).toEqual([15, 5, 0, -10]);
    expect(splines.splines[1].colorDct[1][7]).toBe(1);
    const img = gradientImage(64, 48);
    const planes = sourcePlanes(img);
    const ref = readPfm('features/splines_crafted.ref.pfm');
    expect(maxDiff(planes, ref)).toBeGreaterThan(0.05);
    drawSplines(planes, 64, 48, splines);
    expect(maxDiff(planes, ref)).toBeLessThan(1e-4);
  });
});

// ---------------------------------------------------------------------------------------------
// Splines

const z = () => new Int32Array(32);

describe('spline building blocks', () => {
  it('fastCos / fastErf approximate cos / erf within libjxl bounds', () => {
    for (let x = -20; x <= 20; x += 0.01) expect(Math.abs(fastCos(x) - Math.cos(x))).toBeLessThan(1e-4);
    const erf: [number, number][] = [
      [0, 0],
      [0.25, 0.2763263902],
      [0.5, 0.5204998778],
      [1, 0.8427007929],
      [2, 0.995322265],
      [-1, -0.8427007929],
      [4, 1],
    ];
    for (const [x, v] of erf) expect(Math.abs(fastErf(x) - v)).toBeLessThan(7e-4);
  });

  it('continuousIdct: DC gives sqrt(2) * dct[0]; one AC term is a cosine', () => {
    const dc = new Float32Array(32);
    dc[0] = 1;
    for (const t of [0, 7.5, 31]) expect(continuousIdct(dc, t)).toBeCloseTo(Math.SQRT2, 4);
    const ac = new Float32Array(32);
    ac[3] = 0.5;
    for (const t of [0, 3.3, 20, 31]) {
      expect(continuousIdct(ac, t)).toBeCloseTo(0.5 * Math.SQRT2 * Math.cos((Math.PI / 32) * 3 * (t + 0.5)), 4);
    }
  });

  it('catmullRomPoints: 16 points per interval through the control points', () => {
    const pts = catmullRomPoints([
      [0, 0],
      [10, 0],
      [20, 0],
    ]);
    expect(pts.length).toBe(33);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[16]).toEqual([10, 0]);
    expect(pts[32]).toEqual([20, 0]);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i][1]).toBeCloseTo(0, 9);
      expect(pts[i][0]).toBeGreaterThan(pts[i - 1][0]);
    }
    const curve = catmullRomPoints([
      [0, 0],
      [10, 10],
      [20, 0],
    ]);
    expect(curve[16]).toEqual([10, 10]);
    expect(Math.max(...curve.map((p) => p[1]))).toBeCloseTo(10, 6);
    expect(catmullRomPoints([[3, 4]])).toEqual([[3, 4]]);
  });

  it('equallySpacedPoints steps 1px along the polyline and ends at its last point', () => {
    const poly: [number, number][] = [
      [0, 0],
      [3, 4],
      [3, 7.5],
    ];
    const pts = equallySpacedPoints(poly);
    expect(pts[0]).toEqual([0, 0, 1]);
    for (let i = 1; i < pts.length - 1; i++) {
      expect(pts[i][2]).toBe(1);
      expect(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])).toBeLessThanOrEqual(1 + 1e-9);
    }
    const last = pts[pts.length - 1];
    expect([last[0], last[1]]).toEqual([3, 7.5]);
    expect(last[2]).toBeCloseTo(0.5, 9);
    expect(pts.length - 2 + last[2]).toBeCloseTo(8.5, 9); // arc length
    expect(pts[5]).toEqual([3, 4, 1]);
  });

  it('dequantizeSpline integrates delta-deltas and applies channel weights, quant and color correlation', () => {
    const q = { controlPoints: [1, 0, 0, 1], colorDct: [z(), z(), z()], sigmaDct: z() };
    q.colorDct[0][0] = 10;
    q.colorDct[1][0] = 4;
    q.colorDct[1][1] = 2;
    q.sigmaDct[0] = 6;
    const s = dequantizeSpline(q, [10, 10], 0, 0.5, 1, 1000, { total: 0 });
    expect(s.points).toEqual([
      [10, 10],
      [11, 10],
      [12, 11],
    ]);
    expect(
      continuousIdct(
        s.colorDct[1].map((v, i) => (i ? 0 : v)),
        0,
      ),
    ).toBeCloseTo(4 * 0.075, 5);
    expect(s.colorDct[1][1]).toBeCloseTo(2 * 0.075, 6);
    expect(s.colorDct[0][1]).toBeCloseTo(0.5 * 2 * 0.075, 6); // X += yToX * Y
    expect(s.colorDct[2][1]).toBeCloseTo(2 * 0.075, 6); // B += yToB * Y
    expect(s.sigmaDct[0]).toBeCloseTo(6 * Math.SQRT1_2 * 0.3333, 5);
    const coarse = dequantizeSpline(q, [10, 10], 8, 0, 1, 1000, { total: 0 }); // 1 / (1 + 8/8)
    expect(coarse.sigmaDct[0]).toBeCloseTo(s.sigmaDct[0] / 2, 6);
    const fine = dequantizeSpline(q, [10, 10], -8, 0, 1, 1000, { total: 0 }); // 1 + 8/8
    expect(fine.sigmaDct[0]).toBeCloseTo(s.sigmaDct[0] * 2, 6);
  });

  it('drawSplines renders a symmetric Gaussian ridge proportional to each channel color', () => {
    const color = [z(), z(), z()];
    color[0][0] = 20;
    color[1][0] = 4;
    color[2][0] = -2;
    const sigma = z();
    sigma[0] = 3; // sigma = 3 * 0.3333 ≈ 1
    const splines: JxlSplines = {
      quantAdjustment: 0,
      startingPoints: [[4, 10]],
      splines: [{ controlPoints: [30, 0], colorDct: color, sigmaDct: sigma }],
      imageSize: 40 * 21,
    };
    const w = 40;
    const h = 21;
    const planes: [Float32Array, Float32Array, Float32Array] = [
      new Float32Array(w * h),
      new Float32Array(w * h),
      new Float32Array(w * h),
    ];
    drawSplines(planes, w, h, splines, { yToX: 0, yToB: 0 });
    const at = (c: number, x: number, y: number) => planes[c][y * w + x];
    const peak = at(1, 20, 10);
    expect(peak).toBeGreaterThan(0.1);
    for (let d = 1; d <= 8; d++) {
      expect(at(1, 20, 10 - d)).toBeCloseTo(at(1, 20, 10 + d), 6);
      expect(at(1, 20, 10 + d)).toBeLessThanOrEqual(at(1, 20, 10 + d - 1));
    }
    expect(at(1, 20, 13)).toBeLessThan(at(1, 20, 12));
    // Gaussian-like decay: one sigma ≈ e^-1/2 of the peak, far tail negligible.
    expect(at(1, 20, 11) / peak).toBeGreaterThan(0.45);
    expect(at(1, 20, 11) / peak).toBeLessThan(0.75);
    expect(Math.abs(at(1, 20, 0))).toBeLessThan(1e-4 * peak);
    // Constant along the interior of the line; channels scale with their color (X 20*0.0042, B -2*0.07).
    expect(at(1, 15, 10)).toBeCloseTo(peak, 3);
    expect(at(0, 20, 9) / at(1, 20, 9)).toBeCloseTo((20 * 0.0042) / (4 * 0.075), 4);
    expect(at(2, 20, 9) / at(1, 20, 9)).toBeCloseTo((-2 * 0.07) / (4 * 0.075), 4);
    // Nothing beyond the ends (x 4..34) once past the Gaussian support.
    expect(at(1, 39, 10)).toBeLessThan(1e-5 * peak);
  });

  it('readSplines rejects too many splines for the frame', () => {
    const image = imageHeader();
    const fh = frameHeader(image, { width: 2, height: 2 });
    const br = readerFor((w) => writeSymbols(w, 6, [[2, 5]]));
    expect(() => readSplines(br, fh)).toThrow(/too many splines/);
  });
});

// ---------------------------------------------------------------------------------------------
// Patches

describe('readPatches', () => {
  it('parses references, positions (first absolute, then deltas) and per-channel blending', () => {
    const image = imageHeader({ extraChannels: [alphaInfo(), alphaInfo()] });
    const fh = frameHeader(image, { width: 64, height: 32, encoding: 'modular' });
    const sym: [number, number][] = [[0, 2]]; // 2 reference patches
    // ref 1 at (3,4) size 5x6, 2 positions
    sym.push([1, 1], [3, 3], [3, 4], [2, 4], [2, 5], [7, 1]);
    sym.push([4, 10], [4, 20]);
    sym.push([5, PATCH_BLEND_ABOVE], [8, 1], [9, 1], [5, PATCH_REPLACE], [5, PATCH_MUL], [9, 0]);
    sym.push([6, packSigned(-4)], [6, packSigned(6)]);
    sym.push([5, PATCH_ADD], [5, PATCH_NONE], [5, 6], [8, 0], [9, 0]);
    // ref 0 at (0,0) size 1x1, 1 position
    sym.push([1, 0], [3, 0], [3, 0], [2, 0], [2, 0], [7, 0], [4, 63], [4, 31]);
    sym.push([5, PATCH_REPLACE], [5, PATCH_REPLACE], [5, PATCH_REPLACE]);
    const br = readerFor((w) => writeSymbols(w, 10, sym));
    const patches = readPatches(br, image, fh);
    expect(br.readBits(8)).toBe(0xa5);
    const base = { ref: 1, refX0: 3, refY0: 4, width: 5, height: 6 };
    expect(patches).toEqual([
      {
        ...base,
        x: 10,
        y: 20,
        blending: [
          { mode: PATCH_BLEND_ABOVE, alphaChannel: 1, clamp: true },
          { mode: PATCH_REPLACE, alphaChannel: 0, clamp: false },
          { mode: PATCH_MUL, alphaChannel: 0, clamp: false },
        ],
      },
      {
        ...base,
        x: 6,
        y: 26,
        blending: [
          { mode: PATCH_ADD, alphaChannel: 0, clamp: false },
          { mode: PATCH_NONE, alphaChannel: 0, clamp: false },
          { mode: 6, alphaChannel: 0, clamp: false },
        ],
      },
      {
        ref: 0,
        refX0: 0,
        refY0: 0,
        width: 1,
        height: 1,
        x: 63,
        y: 31,
        blending: [0, 1, 2].map(() => ({ mode: PATCH_REPLACE, alphaChannel: 0, clamp: false })),
      },
    ] satisfies JxlPatch[]);
  });

  it('with a single extra channel the alpha channel is implicit', () => {
    const image = imageHeader({ extraChannels: [alphaInfo()] });
    const fh = frameHeader(image, { width: 8, height: 8, encoding: 'modular' });
    const sym: [number, number][] = [
      [0, 1],
      [1, 2],
      [3, 0],
      [3, 0],
      [2, 1],
      [2, 1],
      [7, 0],
      [4, 1],
      [4, 1],
    ];
    sym.push([5, PATCH_BLEND_ABOVE], [9, 0], [5, PATCH_BLEND_ABOVE], [9, 1]);
    const p = readPatches(
      readerFor((w) => writeSymbols(w, 10, sym)),
      image,
      fh,
    );
    expect(p[0].blending).toEqual([
      { mode: PATCH_BLEND_ABOVE, alphaChannel: 0, clamp: false },
      { mode: PATCH_BLEND_ABOVE, alphaChannel: 0, clamp: true },
    ]);
  });

  it('rejects invalid references, out-of-frame patches and bad blend modes', () => {
    const image = imageHeader();
    const fh = frameHeader(image, { width: 8, height: 8, encoding: 'modular' });
    const parse = (sym: [number, number][]) => () =>
      readPatches(
        readerFor((w) => writeSymbols(w, 10, sym)),
        image,
        fh,
      );
    const head: [number, number][] = [
      [0, 1],
      [3, 0],
      [3, 0],
      [2, 3],
      [2, 3],
      [7, 0],
    ];
    expect(
      parse([
        [0, 1],
        [1, 4],
      ]),
    ).toThrow(/reference frame/);
    expect(parse([[0, 1], [1, 0], ...head.slice(1), [4, 5], [4, 0]])).toThrow(/outside the frame/);
    expect(parse([[0, 1], [1, 0], ...head.slice(1), [4, 0], [4, 0], [5, 8]])).toThrow(/blend mode/);
    expect(parse([[0, 1], [1, 0], ...head.slice(1, 5), [7, 1], [4, 0], [4, 0], [5, 1], [6, packSigned(-1)]])).toThrow(
      /negative/,
    );
  });
});

const ref = (w: number, h: number, f: (c: number, i: number) => number): JxlReferenceFrame => ({
  width: w,
  height: h,
  planes: [0, 1, 2, 3].map((c) => Float32Array.from({ length: w * h }, (_, i) => f(c, i))),
  savedBeforeCt: true,
});
const blend2 = (mode: number) => [0, 1].map(() => ({ mode, alphaChannel: 0, clamp: false }));

describe('applyPatches', () => {
  it('copies / adds the reference rectangle at each position in order, clipped to the frame', () => {
    const r = ref(4, 4, (c, i) => c * 100 + i);
    const planes = [0, 1, 2, 3].map(() => new Float32Array(6 * 5).fill(1000));
    const patches: JxlPatch[] = [
      { ref: 2, refX0: 1, refY0: 1, width: 2, height: 2, x: 0, y: 0, blending: blend2(PATCH_REPLACE) },
      { ref: 2, refX0: 0, refY0: 0, width: 2, height: 2, x: 1, y: 1, blending: blend2(PATCH_ADD) },
      { ref: 2, refX0: 0, refY0: 0, width: 3, height: 3, x: 4, y: 3, blending: blend2(PATCH_REPLACE) },
    ];
    applyPatches(planes, 6, 5, patches, [undefined, undefined, r], [alphaInfo()]);
    const at = (c: number, x: number, y: number) => planes[c][y * 6 + x];
    expect([at(1, 0, 0), at(1, 1, 0), at(1, 0, 1)]).toEqual([105, 106, 109]);
    expect(at(1, 1, 1)).toBe(110 + 100); // replaced (5 + 100 + 5) then + ref(0,0) = 100
    expect(at(3, 2, 2)).toBe(1000 + 305);
    expect([at(0, 4, 3), at(0, 5, 4)]).toEqual([0, 5]); // clipped bottom-right patch
    expect(at(0, 3, 3)).toBe(1000);
  });

  it('requires references saved before the color transform', () => {
    const r = { ...ref(2, 2, () => 0), savedBeforeCt: false };
    const p: JxlPatch[] = [
      {
        ref: 0,
        refX0: 0,
        refY0: 0,
        width: 1,
        height: 1,
        x: 0,
        y: 0,
        blending: [{ mode: 1, alphaChannel: 0, clamp: false }],
      },
    ];
    expect(() => applyPatches([new Float32Array(4)], 2, 2, p, [r], [])).toThrow(/saved after/);
    expect(() => applyPatches([new Float32Array(4)], 2, 2, p, [], [])).toThrow(/empty/);
  });
});

describe('patch oracles (cjxl --patches=1; pixels vs djxl in readJxl.test.ts)', () => {
  for (const name of ['patches_text', 'patches_text_rgba', 'patches_lossy']) {
    it(`${name}.jxl adds patches from a reference-only frame saved before the colour transform`, () => {
      const { codestream: cs } = extractCodestream(asset(`${name}.jxl`));
      const br = new JxlBitReader(cs);
      const h = readImageHeader(br);
      const frames = [];
      for (let pos = br.byteOffset; ;) {
        const fr = decodeFrame(cs, pos, h);
        frames.push(fr);
        pos = fr.frameEnd;
        if (fr.fh.isLast) break;
      }
      expect(frames[0].fh).toMatchObject({ frameType: 'referenceOnly', saveBeforeCt: true });
      const patches = frames.flatMap((f) => f.lfGlobal.patches ?? []);
      expect(patches.length).toBeGreaterThan(5);
      // cjxl subtracts patches from the frame and adds them back
      expect(patches.some((p) => p.blending.some((b) => b.mode === PATCH_ADD))).toBe(true);
    });
  }
});
