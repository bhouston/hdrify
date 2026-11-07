import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JxlBitReader } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import { extractCodestream } from './jxlContainer.js';
import {
  DEFAULT_UPSAMPLING2_WEIGHTS,
  DEFAULT_UPSAMPLING8_WEIGHTS,
  defaultOpsinInverseMatrix,
  describeColorEncoding,
  type JxlImageHeader,
  numColorChannels,
  readImageHeader,
  unpredictIcc,
} from './jxlImageHeader.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../assets/jxl');
const load = (name: string) => new Uint8Array(fs.readFileSync(path.join(ASSETS, name)));
const header = (name: string) => readImageHeader(new JxlBitReader(extractCodestream(load(name)).codestream));

type Expect = [
  w: number,
  h: number,
  bits: number,
  float: boolean,
  xyb: boolean,
  gray: boolean,
  alpha: boolean,
  tf: string,
  intent: string,
];
// Reference values from `jxlinfo -v` (libjxl); xyb follows lossy vs lossless encoding.
const CORPUS: Record<string, Expect> = {
  lossless_float16: [64, 96, 16, true, false, false, false, 'linear', 'perceptual'],
  lossless_float32: [64, 96, 32, true, false, false, false, 'linear', 'relative'],
  lossless_gray8: [96, 48, 8, false, false, true, false, 'srgb', 'perceptual'],
  lossless_multigroup: [300, 150, 8, false, false, false, false, 'srgb', 'perceptual'],
  lossless_palette: [40, 24, 8, false, false, false, false, 'srgb', 'perceptual'],
  lossless_rgb16: [96, 48, 16, false, false, false, false, 'srgb', 'perceptual'],
  lossless_rgb8: [96, 48, 8, false, false, false, false, 'srgb', 'perceptual'],
  lossless_rgb8_container: [96, 48, 8, false, false, false, false, 'srgb', 'perceptual'],
  lossless_rgb8_e1: [96, 48, 8, false, false, false, false, 'srgb', 'perceptual'],
  lossless_rgb8_e9: [96, 48, 8, false, false, false, false, 'srgb', 'perceptual'],
  lossless_rgba8: [64, 64, 8, false, false, false, true, 'srgb', 'absolute'],
  lossless_squeeze: [96, 48, 8, false, false, false, false, 'srgb', 'perceptual'],
  lossy_modular: [96, 48, 8, false, true, false, false, 'srgb', 'perceptual'],
  lossy_modular_gray: [96, 48, 8, false, true, true, false, 'srgb', 'perceptual'],
  vardct_float: [64, 96, 32, true, true, false, false, 'linear', 'relative'],
  vardct_nofilters: [96, 48, 8, false, true, false, false, 'srgb', 'perceptual'],
  vardct_noise: [96, 48, 8, false, true, false, false, 'srgb', 'perceptual'],
  vardct_odd_multigroup: [301, 151, 8, false, true, false, false, 'srgb', 'perceptual'],
  vardct_progressive: [96, 48, 8, false, true, false, false, 'srgb', 'perceptual'],
  vardct_resampling: [96, 48, 8, false, true, false, false, 'srgb', 'perceptual'],
  vardct_rgb8: [96, 48, 8, false, true, false, false, 'srgb', 'perceptual'],
  vardct_rgba8: [64, 64, 8, false, true, false, true, 'srgb', 'absolute'],
  vardct_jpeg444: [96, 48, 8, false, false, false, false, 'srgb', 'relative'],
  vardct_grad128: [128, 128, 8, false, true, false, false, 'srgb', 'perceptual'],
  vardct_d01: [96, 48, 8, false, true, false, false, 'srgb', 'perceptual'],
  vardct_jpeg420: [101, 53, 8, false, false, false, false, 'srgb', 'relative'],
};

describe('readImageHeader on the corpus', () => {
  it('covers every corpus file', () => {
    const files = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.jxl') && !f.startsWith('icc_'));
    expect(files.map((f) => f.slice(0, -4)).sort()).toEqual(Object.keys(CORPUS).sort());
  });

  it.each(Object.entries(CORPUS))('%s matches jxlinfo', (name, [w, h, bits, float, xyb, gray, alpha, tf, intent]) => {
    const hdr = header(`${name}.jxl`);
    expect([hdr.width, hdr.height]).toEqual([w, h]);
    expect(hdr.bitDepth).toEqual({
      floatSample: float,
      bitsPerSample: bits,
      expBits: float ? (bits === 16 ? 5 : 8) : 0,
    });
    expect(hdr.xybEncoded).toBe(xyb);
    expect(hdr.orientation).toBe(1);
    expect(hdr.intrinsicSize ?? { width: w, height: h }).toEqual({ width: w, height: h });
    expect(hdr.preview).toBeUndefined();
    expect(hdr.animation).toBeUndefined();
    expect(numColorChannels(hdr)).toBe(gray ? 1 : 3);
    const ce = hdr.colorEncoding;
    expect(ce).toMatchObject({
      wantIcc: false,
      colorSpace: gray ? 'gray' : 'rgb',
      whitePoint: 'd65',
      primaries: 'srgb',
    });
    expect(ce.transferFunction).toBe(tf);
    expect(ce.renderingIntent).toBe(intent);
    expect(hdr.extraChannels).toEqual(
      alpha
        ? [
            {
              type: 'alpha',
              bitDepth: { floatSample: false, bitsPerSample: 8, expBits: 0 },
              dimShift: 0,
              name: '',
              alphaAssociated: false,
            },
          ]
        : [],
    );
    expect(hdr.toneMapping.intensityTarget).toBe(255);
    expect(hdr.opsinInverse).toEqual(defaultOpsinInverseMatrix());
    expect(hdr.upsampling2Weights).toEqual(DEFAULT_UPSAMPLING2_WEIGHTS);
    expect(hdr.icc).toBeUndefined();
  });

  it('16-bit float sources do not fit modular 16-bit buffers', () => {
    expect(header('lossless_float16.jxl').modular16BitBuffers).toBe(false);
    expect(header('lossless_rgb8.jxl').modular16BitBuffers).toBe(true);
  });

  it('ends byte-aligned where the first frame starts', () => {
    const br = new JxlBitReader(load('lossless_rgb8.jxl'));
    readImageHeader(br);
    expect(br.bitPosition % 8).toBe(0);
  });
});

describe('ICC profile', () => {
  it('reconstructs the embedded profile byte-exactly', () => {
    const hdr = header('icc_rec2020_pq.jxl');
    expect(hdr.colorEncoding.wantIcc).toBe(true);
    expect(hdr.colorEncoding.colorSpace).toBe('rgb');
    expect(describeColorEncoding(hdr.colorEncoding).icc).toBe(true);
    expect(hdr.icc).toEqual(load('icc_rec2020_pq.icc'));
    expect([hdr.width, hdr.height]).toEqual([16, 8]);
  });

  const varint = (n: number) => (n < 128 ? [n] : [(n & 127) | 128, n >> 7]);
  /** Predictor stream: varint(osize), varint(csize), commands, data. */
  const stream = (osize: number, commands: number[], data: number[]) =>
    new Uint8Array([...varint(osize), ...varint(commands.length), ...commands, ...data]);

  it('unpredicts header-only and tag-list + command streams', () => {
    // 4-byte profile: bytes 0..3 are predicted as the big-endian size.
    expect([...unpredictIcc(stream(4, [], [0, 0, 0, 0]))]).toEqual([0, 0, 0, 4]);

    // 128-byte header, 1 tag (rTRC expands to r/g/b TRC), XYZ command, then 'curv' type + 8 inserted bytes.
    const osize = 128 + 4 + 36 + 20 + 8 + 8;
    const commands = [2, 2 | 128, 20, 0, 10, 21, 1, 8];
    const data = [
      ...Array.from({ length: 128 }, () => 0),
      ...Array.from({ length: 12 }, () => 7),
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
    ];
    const out = unpredictIcc(stream(osize, commands, data));
    expect(out.length).toBe(osize);
    const dv = new DataView(out.buffer);
    const str = (at: number) => String.fromCharCode(...out.subarray(at, at + 4));
    expect(dv.getUint32(0)).toBe(osize);
    expect([str(12), str(16), str(20), str(36)]).toEqual(['mntr', 'RGB ', 'XYZ ', 'acsp']);
    expect(dv.getUint32(128)).toBe(1);
    expect([str(132), str(144), str(156)]).toEqual(['rTRC', 'gTRC', 'bTRC']);
    expect([dv.getUint32(136), dv.getUint32(140), dv.getUint32(148)]).toEqual([128 + 12, 20, 128 + 12]);
    expect(str(168)).toBe('XYZ ');
    expect([...out.subarray(176, 188)]).toEqual(Array.from({ length: 12 }, () => 7));
    expect(str(188)).toBe('curv');
    expect([...out.subarray(196)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('applies shuffle and linear prediction commands', () => {
    // After the 128-byte header (all zeros except predicted bytes), Shuffle2 of [1,2,3,4] -> [1,3,2,4],
    // then Predict(width 1, order 1, stride 1) of zero residuals continues the ramp 2*p1 - p2.
    // An empty tag list (numTags varint 1) still writes a zero tag count.
    const commands = [1, 0, 2, 4, 4, 0b0100, 3];
    const out = unpredictIcc(
      stream(128 + 4 + 7, commands, [...Array.from({ length: 128 }, () => 0), 1, 2, 3, 4, 0, 0, 0]),
    );
    expect([...out.subarray(128)]).toEqual([0, 0, 0, 0, 1, 3, 2, 4, 6, 8, 10]);
  });

  it('rejects malformed streams', () => {
    expect(() => unpredictIcc(new Uint8Array([4, 9]))).toThrow(/out of bounds/);
    expect(() => unpredictIcc(stream(4, [], [0, 0, 0]))).toThrow(/out of bounds/);
    expect(() => unpredictIcc(stream(4, [], [0, 0, 0, 0, 1]))).toThrow(/unused/);
    expect(() =>
      unpredictIcc(
        stream(
          129,
          [],
          Array.from({ length: 128 }, () => 0),
        ),
      ),
    ).toThrow(/tag list/);
    expect(() =>
      unpredictIcc(
        stream(
          132,
          [1, 0, 99],
          Array.from({ length: 128 }, () => 0),
        ),
      ),
    ).toThrow(/unknown command/);
  });
});

// ---- Synthetic streams ----

type W = JxlBitWriter;
const SIZE_FULL = [
  { bits: 9, offset: 1 },
  { bits: 13, offset: 1 },
  { bits: 18, offset: 1 },
  { bits: 30, offset: 1 },
] as const;
const NAME = [0, { bits: 4 }, { bits: 5, offset: 16 }, { bits: 10, offset: 48 }] as const;
const DIM_SHIFT = [0, 3, 4, { bits: 3, offset: 1 }] as const;
const INT_BITS = [8, 10, 12, { bits: 6, offset: 1 }] as const;
const F16_ONE = 0x3c00;
const F16_HALF = 0x3800;

function build(size: (w: W) => void, meta?: (w: W) => void, transform?: (w: W) => void): JxlImageHeader {
  const w = new JxlBitWriter();
  w.writeBits(16, 0x0aff);
  size(w);
  w.writeBool(!meta);
  meta?.(w);
  w.writeBool(!transform); // default_m
  transform?.(w);
  return readImageHeader(new JxlBitReader(w.finish()));
}

const fullSize = (wd: number, ht: number) => (w: W) => {
  w.writeBool(false);
  w.writeU32(ht, ...SIZE_FULL);
  w.writeBits(3, 0);
  w.writeU32(wd, ...SIZE_FULL);
};

interface MetaOpts {
  extra?: (w: W) => void;
  tone?: (w: W) => void;
  numEc?: number;
  ec?: (w: W) => void;
  xyb?: boolean;
  color?: (w: W) => void;
  ext?: (w: W) => void;
}

/** ImageMetadata body after all_default = 0; unspecified parts are written as defaults. */
const meta = (o: MetaOpts) => (w: W) => {
  w.writeBool(!!o.extra);
  o.extra?.(w);
  w.writeBool(false);
  w.writeU32(8, ...INT_BITS);
  w.writeBool(true); // modular_16bit_buffers
  w.writeU32(o.numEc ?? 0, 0, 1, { bits: 4, offset: 2 }, { bits: 12, offset: 1 });
  o.ec?.(w);
  w.writeBool(o.xyb ?? true);
  if (o.color) o.color(w);
  else w.writeBool(true);
  if (o.extra) {
    if (o.tone) o.tone(w);
    else w.writeBool(true);
  }
  if (o.ext) o.ext(w);
  else w.writeU64(0);
};

describe('SizeHeader', () => {
  it('reads small (div8) sizes and every aspect ratio', () => {
    const h = build((w) => {
      w.writeBool(true);
      w.writeBits(5, 3); // height 32
      w.writeBits(3, 0);
      w.writeBits(5, 31); // width 256
    });
    expect([h.width, h.height]).toEqual([256, 32]);
    const expected = [90, 108, 120, 135, 160, 112, 180];
    expected.forEach((width, i) => {
      const hh = build((w) => {
        w.writeBool(false);
        w.writeU32(90, ...SIZE_FULL);
        w.writeBits(3, i + 1);
      });
      expect([hh.width, hh.height]).toEqual([width, 90]);
    });
  });

  it('reads large U32 sizes', () => {
    const h = build(fullSize(2 ** 30, 300000));
    expect([h.width, h.height]).toEqual([2 ** 30, 300000]);
  });

  it('rejects a bad signature', () => {
    expect(() => readImageHeader(new JxlBitReader(new Uint8Array([0xff, 0x0b, 0, 0])))).toThrow(/signature/);
  });

  it('all_default metadata gives XYB, 8-bit sRGB', () => {
    const h = build(fullSize(10, 20));
    expect(h).toMatchObject({ xybEncoded: true, orientation: 1, bitDepth: { bitsPerSample: 8 }, extraChannels: [] });
    expect(h.colorEncoding).toEqual({
      wantIcc: false,
      colorSpace: 'rgb',
      whitePoint: 'd65',
      primaries: 'srgb',
      transferFunction: 'srgb',
      renderingIntent: 'relative',
    });
  });
});

describe('ImageMetadata', () => {
  it('reads extra fields: orientation, intrinsic size, preview, animation, tone mapping', () => {
    const h = build(
      fullSize(64, 64),
      meta({
        extra: (w) => {
          w.writeBits(3, 5); // orientation 6
          w.writeBool(true);
          fullSize(100, 50)(w);
          w.writeBool(true); // preview: div8, h_div8 = 32 -> 256, ratio 7 -> 512
          w.writeBool(true);
          w.writeU32(32, 16, 32, { bits: 5, offset: 1 }, { bits: 9, offset: 33 });
          w.writeBits(3, 7);
          w.writeBool(true); // animation
          w.writeU32(1000, 100, 1000, { bits: 10, offset: 1 }, { bits: 30, offset: 1 });
          w.writeU32(1001, 1, 1001, { bits: 8, offset: 1 }, { bits: 10, offset: 1 });
          w.writeU32(65535, 0, { bits: 3 }, { bits: 16 }, { bits: 32 });
          w.writeBool(true);
        },
        tone: (w) => {
          w.writeBool(false);
          w.writeBits(16, 0x6400); // 1024
          w.writeBits(16, F16_ONE);
          w.writeBool(true);
          w.writeBits(16, F16_HALF);
        },
      }),
    );
    expect(h.orientation).toBe(6);
    expect(h.intrinsicSize).toEqual({ width: 100, height: 50 });
    expect(h.preview).toEqual({ width: 512, height: 256 });
    expect(h.animation).toEqual({ tpsNumerator: 1000, tpsDenominator: 1001, numLoops: 65535, haveTimecodes: true });
    expect(h.toneMapping).toEqual({ intensityTarget: 1024, minNits: 1, relativeToMaxDisplay: true, linearBelow: 0.5 });
  });

  it('rejects invalid tone mapping', () => {
    const bad = () =>
      build(
        fullSize(8, 8),
        meta({
          extra: (w) => w.writeBits(3 + 3, 0),
          tone: (w) => {
            w.writeBool(false);
            w.writeBits(16, F16_ONE);
            w.writeBits(16, 0x4000); // min_nits 2 > intensity 1
            w.writeBool(false);
            w.writeBits(16, 0);
          },
        }),
      );
    expect(bad).toThrow(/tone mapping/);
  });

  it('reads extra channel infos of every flavor', () => {
    const h = build(
      fullSize(8, 8),
      meta({
        numEc: 4,
        ec: (w) => {
          w.writeBool(true); // default alpha
          // spot color: float16, dim_shift 3, name "ink", RGBA = 1
          w.writeBool(false);
          w.writeEnum(2);
          w.writeBool(true);
          w.writeU32(16, 32, 16, 24, { bits: 6, offset: 1 });
          w.writeBits(4, 4);
          w.writeU32(3, ...DIM_SHIFT);
          w.writeU32(3, ...NAME);
          for (const c of 'ink') w.writeBits(8, c.charCodeAt(0));
          for (let i = 0; i < 4; i++) w.writeBits(16, F16_ONE);
          // CFA channel 7, 12-bit
          w.writeBool(false);
          w.writeEnum(5);
          w.writeBool(false);
          w.writeU32(12, ...INT_BITS);
          w.writeU32(0, ...DIM_SHIFT);
          w.writeU32(0, ...NAME);
          w.writeU32(7, 1, { bits: 2 }, { bits: 4, offset: 3 }, { bits: 8, offset: 19 });
          // premultiplied alpha
          w.writeBool(false);
          w.writeEnum(0);
          w.writeBool(false);
          w.writeU32(8, ...INT_BITS);
          w.writeU32(0, ...DIM_SHIFT);
          w.writeU32(0, ...NAME);
          w.writeBool(true);
        },
      }),
    );
    expect(h.extraChannels.map((e) => e.type)).toEqual(['alpha', 'spotColor', 'cfa', 'alpha']);
    expect(h.extraChannels[1]).toEqual({
      type: 'spotColor',
      bitDepth: { floatSample: true, bitsPerSample: 16, expBits: 5 },
      dimShift: 3,
      name: 'ink',
      alphaAssociated: false,
      spotColor: [1, 1, 1, 1],
    });
    expect(h.extraChannels[2]).toMatchObject({ cfaChannel: 7, bitDepth: { bitsPerSample: 12 } });
    expect(h.extraChannels[3].alphaAssociated).toBe(true);
  });

  it('rejects reserved extra channel types and bad bit depths', () => {
    const ec = (body: (w: W) => void) => () => build(fullSize(8, 8), meta({ numEc: 1, ec: body }));
    expect(
      ec((w) => {
        w.writeBool(false);
        w.writeEnum(7);
      }),
    ).toThrow(/extra channel type/);
    expect(
      ec((w) => {
        w.writeBool(false);
        w.writeEnum(1);
        w.writeBool(false);
        w.writeU32(40, ...INT_BITS);
      }),
    ).toThrow(/bits_per_sample/);
  });

  it('reads custom white point, primaries, gamma and rendering intent', () => {
    const xy = (w: W, v: number) =>
      w.writeU32(
        v,
        { bits: 19 },
        { bits: 19, offset: 524288 },
        { bits: 20, offset: 1048576 },
        { bits: 21, offset: 2097152 },
      );
    const h = build(
      fullSize(8, 8),
      meta({
        xyb: false,
        color: (w) => {
          w.writeBool(false);
          w.writeBool(false);
          w.writeEnum(0); // rgb
          w.writeEnum(2); // custom white point (zig-zag coded)
          xy(w, 2 * 345_700);
          xy(w, 2 * 358_500);
          w.writeEnum(2); // custom primaries
          xy(w, 2 * 708_000);
          xy(w, 2 * 292_000);
          xy(w, 2 * 170_000);
          xy(w, 2 * 797_000);
          xy(w, 2 * 131_000);
          xy(w, 2 * 46_000 - 1); // -0.046
          w.writeBool(true); // gamma
          w.writeBits(24, 4_545_455);
          w.writeEnum(3);
        },
      }),
    );
    const ce = h.colorEncoding;
    expect(ce.whiteXy).toEqual([0.3457, 0.3585]);
    expect(ce.primariesXy).toEqual([
      [0.708, 0.292],
      [0.17, 0.797],
      [0.131, -0.046],
    ]);
    expect(ce).toMatchObject({ transferFunction: 'gamma', gamma: 0.4545455, renderingIntent: 'absolute' });
    expect(describeColorEncoding(ce)).toEqual({
      icc: false,
      colorSpace: 'rgb',
      primaries: { red: [0.708, 0.292], green: [0.17, 0.797], blue: [0.131, -0.046] },
      whitePoint: [0.3457, 0.3585],
      transfer: 0.4545455,
    });
  });

  it('reads enum color encodings (gray skips primaries, XYB skips white point and transfer)', () => {
    const enc = (cs: number, rest: (w: W) => void) =>
      build(
        fullSize(8, 8),
        meta({
          xyb: false,
          color: (w) => {
            w.writeBool(false);
            w.writeBool(false);
            w.writeEnum(cs);
            rest(w);
          },
        }),
      ).colorEncoding;
    const gray = enc(1, (w) => {
      w.writeEnum(11); // DCI white
      w.writeBool(false);
      w.writeEnum(18); // HLG
      w.writeEnum(0);
    });
    expect(gray).toMatchObject({ colorSpace: 'gray', whitePoint: 'dci', primaries: 'srgb', transferFunction: 'hlg' });
    const pq = enc(0, (w) => {
      w.writeEnum(1);
      w.writeEnum(9); // bt2100
      w.writeBool(false);
      w.writeEnum(16);
      w.writeEnum(2);
    });
    expect(describeColorEncoding(pq)).toMatchObject({ primaries: 'rec2020', whitePoint: 'd65', transfer: 'pq' });
    expect(pq.renderingIntent).toBe('saturation');
    const xyb = enc(2, (w) => w.writeEnum(1));
    expect(xyb).toMatchObject({
      colorSpace: 'xyb',
      transferFunction: 'gamma',
      gamma: 1 / 3,
      renderingIntent: 'relative',
    });
    const p3 = enc(0, (w) => {
      w.writeEnum(10);
      w.writeEnum(11);
      w.writeBool(false);
      w.writeEnum(1);
      w.writeEnum(0);
    });
    expect(describeColorEncoding(p3)).toMatchObject({ primaries: 'p3', whitePoint: 'e', transfer: '709' });
    expect(() => enc(0, (w) => w.writeEnum(3))).toThrow(/white point/);
    expect(() => enc(4, () => {})).toThrow(/color space/);
  });

  it('skips extensions by their bit lengths', () => {
    const h = build(
      fullSize(8, 8),
      meta({
        ext: (w) => {
          w.writeU64(0b101); // extensions 0 and 2
          w.writeU64(5);
          w.writeU64(300);
          w.writeBits(5, 0b10101);
          for (let i = 0; i < 300; i++) w.writeBits(1, i & 1);
        },
      }),
      (w) => {
        w.writeBool(true); // opsin all_default
        w.writeBits(3, 1);
        for (let i = 0; i < 15; i++) w.writeBits(16, F16_ONE);
      },
    );
    expect(h.upsampling2Weights).toEqual(Array.from({ length: 15 }, () => 1));
    expect(h.upsampling8Weights).toEqual(DEFAULT_UPSAMPLING8_WEIGHTS);
  });

  it('reads a custom opsin inverse matrix and upsampling weights', () => {
    const h = build(fullSize(8, 8), undefined, (w) => {
      w.writeBool(false);
      for (let i = 0; i < 16; i++) w.writeBits(16, i % 2 ? F16_HALF : F16_ONE);
      w.writeBits(3, 6);
      for (let i = 0; i < 55 + 210; i++) w.writeBits(16, F16_HALF);
    });
    expect(h.opsinInverse.matrix).toEqual([1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1]);
    expect(h.opsinInverse.opsinBias).toEqual([0.5, 1, 0.5]);
    expect(h.opsinInverse.quantBias).toEqual([1, 0.5, 1]);
    expect(h.opsinInverse.quantBiasNumerator).toBe(0.5);
    expect(h.upsampling2Weights).toEqual(DEFAULT_UPSAMPLING2_WEIGHTS);
    expect(h.upsampling4Weights).toEqual(Array.from({ length: 55 }, () => 0.5));
    expect(h.upsampling8Weights).toEqual(Array.from({ length: 210 }, () => 0.5));
  });
});
