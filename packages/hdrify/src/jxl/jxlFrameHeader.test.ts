import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JxlBitReader } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import { extractCodestream } from './jxlContainer.js';
import {
  defaultRestorationFilter,
  frameDimensions,
  groupRect,
  type JxlFrameHeader,
  lfGroupRect,
  readFrameHeader,
  readToc,
  tocEntryCount,
} from './jxlFrameHeader.js';
import { type JxlImageHeader, readImageHeader } from './jxlImageHeader.js';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../assets/jxl');

interface ParsedFrame {
  fh: JxlFrameHeader;
  tocEntries: number;
  permuted: boolean;
}

/** Walk every frame of a file: header, TOC, then skip the sections to the next frame. */
function parseFile(name: string): { image: JxlImageHeader; frames: ParsedFrame[]; end: number; length: number } {
  const { codestream } = extractCodestream(new Uint8Array(fs.readFileSync(path.join(ASSETS, name))));
  const br = new JxlBitReader(codestream);
  const image = readImageHeader(br);
  const frames: ParsedFrame[] = [];
  let pos = br.byteOffset;
  for (;;) {
    const fbr = new JxlBitReader(codestream, pos);
    const fh = readFrameHeader(fbr, image);
    const toc = readToc(fbr, fh);
    pos = fbr.byteOffset + toc.sizes.reduce((a, b) => a + b, 0);
    frames.push({ fh, tocEntries: toc.sizes.length, permuted: !!toc.permutation });
    if (fh.isLast) break;
  }
  return { image, frames, end: pos, length: codestream.length };
}

// [encoding, upsampling, groupSizeShift, noise, gab, epfIters, tocEntries, numGroups]
type Frame = [string, number, number, boolean, boolean, number, number, number];
const SIMPLE_MODULAR: Frame = ['modular', 1, 0, false, false, 0, 1, 1];
const SIMPLE_VARDCT: Frame = ['vardct', 1, 1, false, true, 1, 1, 1];
const CORPUS: Record<string, Frame> = {
  lossless_float16: SIMPLE_MODULAR,
  lossless_float32: SIMPLE_MODULAR,
  lossless_gray8: SIMPLE_MODULAR,
  lossless_multigroup: ['modular', 1, 0, false, false, 0, 9, 6], // 300x150 at 128px groups: 3x2
  lossless_palette: SIMPLE_MODULAR,
  lossless_rgb16: SIMPLE_MODULAR,
  lossless_rgb8: SIMPLE_MODULAR,
  lossless_rgb8_container: SIMPLE_MODULAR,
  lossless_rgb8_e1: ['modular', 1, 1, false, false, 0, 1, 1],
  lossless_rgb8_e9: SIMPLE_MODULAR,
  lossless_rgba8: SIMPLE_MODULAR,
  lossless_squeeze: SIMPLE_MODULAR,
  lossy_modular: SIMPLE_MODULAR,
  icc_rec2020_pq: SIMPLE_MODULAR,
  vardct_float: SIMPLE_VARDCT,
  vardct_nofilters: ['vardct', 1, 1, false, false, 0, 1, 1],
  vardct_noise: ['vardct', 1, 1, true, true, 1, 1, 1],
  vardct_odd_multigroup: ['vardct', 1, 1, false, true, 2, 5, 2], // 301x151 at 256px groups: 2x1
  vardct_resampling: ['vardct', 2, 1, false, true, 3, 1, 1],
  vardct_rgb8: SIMPLE_VARDCT,
  vardct_rgba8: SIMPLE_VARDCT,
};

describe('frame headers and TOC on the corpus', () => {
  it('covers every corpus file', () => {
    const files = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.jxl'));
    expect(files.map((f) => f.slice(0, -4)).sort()).toEqual([...Object.keys(CORPUS), 'vardct_progressive'].sort());
  });

  it.each(Object.entries(CORPUS))('%s', (name, [encoding, upsampling, gss, noise, gab, epf, tocEntries, numGroups]) => {
    const { image, frames, end, length } = parseFile(`${name}.jxl`);
    expect(end).toBe(length); // TOC sizes account for the whole codestream
    expect(frames.length).toBe(1);
    const { fh } = frames[0];
    expect(fh).toMatchObject({
      frameType: 'regular',
      encoding,
      upsampling,
      groupSizeShift: gss,
      noise,
      patches: false,
      splines: false,
      useLfFrame: false,
      doYCbCr: false,
      haveCrop: false,
      width: image.width,
      height: image.height,
      isLast: true,
      passes: { numPasses: 1 },
      blendingInfo: { mode: 'replace' },
      name: '',
    });
    expect(fh.ecUpsampling).toEqual(image.extraChannels.map(() => 1));
    expect(fh.restorationFilter.gab).toBe(gab);
    expect(fh.restorationFilter.epfIters).toBe(epf);
    expect(frames[0].tocEntries).toBe(tocEntries);
    expect(frames[0].permuted).toBe(false);
    expect(frameDimensions(fh).numGroups).toBe(numGroups);
    expect(frameDimensions(fh).numLfGroups).toBe(1);
  });

  it('vardct_progressive: LF frame + 3-pass VarDCT frame with permuted TOCs', () => {
    const { frames, end, length } = parseFile('vardct_progressive.jxl');
    expect(end).toBe(length);
    expect(frames.map((f) => [f.fh.frameType, f.fh.encoding, f.fh.lfLevel, f.fh.isLast])).toEqual([
      ['lf', 'modular', 1, false],
      ['regular', 'vardct', 0, true],
    ]);
    const [lf, main] = frames as [ParsedFrame, ParsedFrame];
    expect(lf.fh.saveBeforeCt).toBe(true);
    expect(frameDimensions(lf.fh)).toMatchObject({ width: 12, height: 6 }); // 96x48 / 8
    expect(main.fh.useLfFrame).toBe(true);
    expect(main.fh.passes.numPasses).toBe(3);
    expect([lf.tocEntries, main.tocEntries]).toEqual([2 + 1 + 3, 2 + 1 + 3]);
    expect(main.permuted).toBe(true);
  });

  it('permuted TOC offsets follow the permutation', () => {
    const { codestream } = extractCodestream(
      new Uint8Array(fs.readFileSync(path.join(ASSETS, 'vardct_progressive.jxl'))),
    );
    const br = new JxlBitReader(codestream);
    const fh = readFrameHeader(br, readImageHeader(br));
    const toc = readToc(br, fh);
    const perm = toc.permutation!;
    expect([...perm].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    // Original (stored-order) offsets are a prefix sum; logical entry i points at stored entry perm[i].
    const stored = Array.from({ length: 6 }, () => 0);
    const storedOffsets = Array.from({ length: 6 }, () => 0);
    perm.forEach((p, i) => {
      stored[p] = toc.sizes[i]!;
      storedOffsets[p] = toc.offsets[i]!;
    });
    let off = 0;
    for (let i = 0; i < 6; i++) {
      expect(storedOffsets[i]).toBe(off);
      off += stored[i];
    }
  });

  it('vardct_resampling: coded size is half the image size', () => {
    const { frames } = parseFile('vardct_resampling.jxl');
    expect(frameDimensions(frames[0].fh)).toMatchObject({
      width: 48,
      height: 24,
      upsampledWidth: 96,
      upsampledHeight: 48,
    });
  });

  it('vardct_odd_multigroup: group rects cover the frame', () => {
    const d = frameDimensions(parseFile('vardct_odd_multigroup.jxl').frames[0].fh);
    expect(d).toMatchObject({ groupDim: 256, groupsPerRow: 2, groupRows: 1, xsizeBlocks: 38, ysizeBlocks: 19 });
    expect(groupRect(d, 0)).toEqual({ x: 0, y: 0, width: 256, height: 151 });
    expect(groupRect(d, 1)).toEqual({ x: 256, y: 0, width: 45, height: 151 });
    expect(lfGroupRect(d, 0)).toEqual({ x: 0, y: 0, width: 301, height: 151 });
  });

  it('lossless_multigroup: group rects tile 300x150 with 128px groups', () => {
    const d = frameDimensions(parseFile('lossless_multigroup.jxl').frames[0].fh);
    expect(groupRect(d, 2)).toEqual({ x: 256, y: 0, width: 44, height: 128 });
    expect(groupRect(d, 5)).toEqual({ x: 256, y: 128, width: 44, height: 22 });
  });
});

// ---- Synthetic streams ----

const BASE = readImageHeader(new JxlBitReader(new Uint8Array(fs.readFileSync(path.join(ASSETS, 'lossless_rgb8.jxl')))));
const image = (o: Partial<JxlImageHeader> = {}): JxlImageHeader => ({ ...BASE, ...o });
const ALPHA = { type: 'alpha' as const, bitDepth: BASE.bitDepth, dimShift: 0, name: '', alphaAssociated: false };
const CROP = [{ bits: 8 }, { bits: 11, offset: 256 }, { bits: 14, offset: 2304 }, { bits: 30, offset: 18688 }] as const;
const NAME = [0, { bits: 4 }, { bits: 5, offset: 16 }, { bits: 10, offset: 48 }] as const;
const BLEND = [0, 1, 2, { bits: 2, offset: 3 }] as const;
const U1248 = [1, 2, 4, 8] as const;
const F16_HALF = 0x3800;
const F16_ONE = 0x3c00;
const F16_TWO = 0x4000;

function frame(img: JxlImageHeader, body: (w: JxlBitWriter) => void): JxlFrameHeader {
  const w = new JxlBitWriter();
  body(w);
  return readFrameHeader(new JxlBitReader(w.finish()), img);
}

describe('readFrameHeader (synthetic)', () => {
  it('all_default frame', () => {
    const fh = frame(image({ xybEncoded: true }), (w) => w.writeBool(true));
    expect(fh).toMatchObject({
      frameType: 'regular',
      encoding: 'vardct',
      upsampling: 1,
      groupSizeShift: 1,
      xQmScale: 3,
      bQmScale: 2,
      isLast: true,
      width: 96,
      height: 48,
    });
    expect(fh.restorationFilter).toEqual(defaultRestorationFilter());
    expect(tocEntryCount(fh)).toBe(1);
  });

  it('reads a cropped, blended, animated, non-last modular frame with every optional field', () => {
    const img = image({
      extraChannels: [ALPHA, { ...ALPHA, dimShift: 1 }],
      animation: { tpsNumerator: 100, tpsDenominator: 1, numLoops: 0, haveTimecodes: true },
    });
    const fh = frame(img, (w) => {
      w.writeBool(false);
      w.writeBits(2, 0); // regular
      w.writeBool(true); // modular
      w.writeU64(0x1 | 0x2 | 0x10 | 0x80);
      w.writeBool(true); // do_YCbCr
      for (const m of [1, 0, 2]) w.writeBits(2, m);
      w.writeU32(2, ...U1248); // upsampling
      w.writeU32(2, ...U1248); // ec 0: 2
      w.writeU32(4, ...U1248); // ec 1: 4 << dim_shift 1 = 8
      w.writeBits(2, 3); // group_size_shift
      w.writeU32(2, 1, 2, 3, { bits: 3, offset: 4 }); // 2 passes
      w.writeU32(1, 0, 1, 2, { bits: 1, offset: 3 }); // 1 downsample
      w.writeBits(2, 2);
      w.writeU32(4, ...U1248);
      w.writeU32(0, 0, 1, 2, { bits: 3 });
      w.writeBool(true); // crop
      w.writeU32(5, ...CROP); // x0 = UnpackSigned(5) = -3
      w.writeU32(300, ...CROP); // y0 = 150
      w.writeU32(20000, ...CROP);
      w.writeU32(10, ...CROP);
      w.writeU32(2, ...BLEND); // color: blend, alpha 1, clamp, source 3
      w.writeU32(1, 0, 1, 2, { bits: 3, offset: 3 });
      w.writeBool(true);
      w.writeBits(2, 3);
      w.writeU32(4, ...BLEND); // ec0: mul (clamp read), source 1
      w.writeBool(false);
      w.writeBits(2, 1);
      w.writeU32(0, ...BLEND); // ec1: replace; partial frame -> source read
      w.writeBits(2, 2);
      w.writeU32(77, 0, 1, { bits: 8 }, { bits: 32 }); // duration
      w.writeBits(32, 0xdeadbeef); // timecode
      w.writeBool(false); // is_last
      w.writeBits(2, 3); // save_as_reference; save_before_ct not coded (blended frame)
      w.writeU32(2, ...NAME);
      w.writeBits(8, 0x68);
      w.writeBits(8, 0x69);
      w.writeBool(false); // restoration filter: custom gab, epf 3, custom weights + sigma (modular)
      w.writeBool(true);
      w.writeBool(true);
      for (let i = 0; i < 6; i++) w.writeBits(16, F16_HALF);
      w.writeBits(2, 3);
      w.writeBool(true);
      for (let i = 0; i < 5; i++) w.writeBits(16, F16_ONE);
      w.writeBool(true);
      for (let i = 0; i < 3; i++) w.writeBits(16, F16_TWO);
      w.writeBits(16, 0x4400); // sigma for modular = 4
      w.writeU64(0); // restoration filter extensions
      w.writeU64(1); // frame extensions: one, 3 bits long
      w.writeU64(3);
      w.writeBits(3, 7);
    });
    expect(fh).toMatchObject({
      encoding: 'modular',
      noise: true,
      patches: true,
      splines: true,
      useLfFrame: false,
      skipAdaptiveLfSmoothing: true,
      doYCbCr: true,
      jpegUpsampling: [1, 0, 2],
      upsampling: 2,
      ecUpsampling: [2, 4],
      groupSizeShift: 3,
      xQmScale: 2,
      passes: { numPasses: 2, numDs: 1, shift: [2, 0], downsample: [4], lastPass: [0] },
      haveCrop: true,
      x0: -3,
      y0: 150,
      width: 20000,
      height: 10,
      blendingInfo: { mode: 'blend', alphaChannel: 1, clamp: true, source: 3 },
      ecBlendingInfo: [
        { mode: 'mul', alphaChannel: 0, clamp: false, source: 1 },
        { mode: 'replace', alphaChannel: 0, clamp: false, source: 2 },
      ],
      duration: 77,
      timecode: 0xdeadbeef,
      isLast: false,
      saveAsReference: 3,
      saveBeforeCt: false,
      name: 'hi',
    });
    const rf = fh.restorationFilter;
    expect(rf.gabWeights).toEqual(Array.from({ length: 6 }, () => 0.5));
    expect(rf).toMatchObject({
      epfIters: 3,
      epfSharpCustom: false,
      epfChannelScale: [1, 1, 1],
      epfPass1Zeroflush: 1,
      epfPass2Zeroflush: 1,
    });
    expect(rf).toMatchObject({
      epfQuantMul: 0.46,
      epfPass0SigmaScale: 2,
      epfPass2SigmaScale: 2,
      epfBorderSadMul: 2,
      epfSigmaForModular: 4,
    });

    const d = frameDimensions(fh);
    expect(d).toMatchObject({
      width: 10000,
      height: 5,
      maxHShift: 1,
      maxVShift: 1,
      groupDim: 1024,
      xsizeBlocks: 1250,
      ysizeBlocks: 2,
    });
    expect(d).toMatchObject({ numGroups: 10, numLfGroups: 2 });
    expect(tocEntryCount(fh)).toBe(2 + 2 + 10 * 2);
  });

  it('reads a reference-only frame, an LF frame, and VarDCT-only fields', () => {
    const xyb = image({ xybEncoded: true });
    const ref = frame(xyb, (w) => {
      w.writeBool(false);
      w.writeBits(2, 2); // reference only
      w.writeBool(false); // vardct
      w.writeU64(0);
      w.writeU32(1, ...U1248);
      w.writeBits(3, 5);
      w.writeBits(3, 6);
      w.writeBool(false); // no crop
      w.writeBits(2, 1); // save_as_reference (is_last is implicitly false)
      w.writeBool(false); // save_before_ct
      w.writeU32(0, ...NAME);
      w.writeBool(false); // restoration filter: gab off, epf 1 with custom sharpness and sigma
      w.writeBool(false);
      w.writeBits(2, 1);
      w.writeBool(true);
      for (let i = 0; i < 8; i++) w.writeBits(16, F16_ONE);
      w.writeBool(false);
      w.writeBool(true);
      for (let i = 0; i < 4; i++) w.writeBits(16, F16_HALF);
      w.writeU64(0);
      w.writeU64(0);
    });
    expect(ref).toMatchObject({
      frameType: 'referenceOnly',
      isLast: false,
      saveAsReference: 1,
      saveBeforeCt: false,
      xQmScale: 5,
      bQmScale: 6,
    });
    expect(ref.passes.numPasses).toBe(1);
    expect(ref.restorationFilter).toMatchObject({
      gab: false,
      epfIters: 1,
      epfSharpLut: Array.from({ length: 8 }, () => 1),
      epfQuantMul: 0.5,
      epfBorderSadMul: 0.5,
    });

    const lf = frame(xyb, (w) => {
      w.writeBool(false);
      w.writeBits(2, 1); // LF
      w.writeBool(true); // modular
      w.writeU64(0);
      w.writeU32(1, ...U1248);
      w.writeBits(2, 1);
      w.writeU32(1, 1, 2, 3, { bits: 3, offset: 4 });
      w.writeU32(2, 1, 2, 3, 4); // lf_level 2
      w.writeU32(0, ...NAME);
      w.writeBool(true);
      w.writeU64(0);
    });
    expect(lf).toMatchObject({ frameType: 'lf', lfLevel: 2, isLast: false, saveBeforeCt: true, saveAsReference: 0 });
    expect(frameDimensions(lf)).toMatchObject({ width: 2, height: 1 }); // ceil(96/64), ceil(48/64)
  });

  it('rejects invalid values', () => {
    const img = image({ extraChannels: [ALPHA] });
    const prefix = (w: JxlBitWriter) => {
      w.writeBool(false);
      w.writeBits(2, 0);
      w.writeBool(true);
      w.writeU64(0);
      w.writeBool(false); // do_YCbCr
    };
    expect(() =>
      frame(img, (w) => {
        prefix(w);
        w.writeU32(4, ...U1248);
        w.writeU32(2, ...U1248); // ec upsampling < color upsampling
      }),
    ).toThrow(/extra channel upsampling/);
    expect(() =>
      frame(img, (w) => {
        prefix(w);
        w.writeU32(1, ...U1248);
        w.writeU32(1, ...U1248);
        w.writeBits(2, 1);
        w.writeU32(1, 1, 2, 3, { bits: 3, offset: 4 });
        w.writeBool(true); // crop of zero width
        w.writeU32(0, ...CROP);
        w.writeU32(0, ...CROP);
        w.writeU32(0, ...CROP);
        w.writeU32(5, ...CROP);
      }),
    ).toThrow(/zero-sized/);
  });
});

describe('readToc (synthetic)', () => {
  const tocDist = [
    { bits: 10 },
    { bits: 14, offset: 1024 },
    { bits: 22, offset: 17408 },
    { bits: 30, offset: 4211712 },
  ] as const;

  it('reads a multi-entry TOC with every size distribution and computes offsets', () => {
    const fh = frame(image({ width: 300, height: 150 }), (w) => w.writeBool(true));
    expect(tocEntryCount(fh)).toBe(2 + 1 + 2); // 256px VarDCT groups: 2x1
    const sizes = [5, 1024, 17408, 4211712, 0];
    const w = new JxlBitWriter();
    w.writeBits(3, 0b101); // unrelated bits: the TOC starts mid-byte
    w.writeBool(false); // not permuted
    w.zeroPadToByte();
    for (const s of sizes) w.writeU32(s, ...tocDist);
    const br = new JxlBitReader(w.finish());
    br.readBits(3);
    const toc = readToc(br, fh);
    expect(toc).toEqual({ sizes, offsets: [0, 5, 1029, 18437, 4230149] });
    expect(br.bitPosition % 8).toBe(0);
  });

  it('rejects non-zero padding', () => {
    const fh = frame(image(), (w) => w.writeBool(true));
    const w = new JxlBitWriter();
    w.writeBool(false);
    w.writeBits(7, 1);
    w.writeBits(16, 0);
    expect(() => readToc(new JxlBitReader(w.finish()), fh)).toThrow(/padding/);
  });
});
