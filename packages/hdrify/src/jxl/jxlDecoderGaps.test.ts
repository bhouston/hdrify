import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readJxl, readJxlFrames, type JxlExtraChannel } from '../index.js';
import { ASSETS, readPfm, readPnm } from './jxlTestAssets.js';
import { linearTosRGB } from '../color/srgb.js';
import { JxlBitReader } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import { writeBitDepth, writeSizeHeader } from './jxlEncHeaders.js';
import { readImageHeader } from './jxlImageHeader.js';
import { writeJxl } from './writeJxl.js';
import { extractCodestream } from './jxlContainer.js';

const bytes = (name: string) => new Uint8Array(fs.readFileSync(new URL(`features/${name}.jxl`, ASSETS)));

// A complete, independent 1x1 preview before a 3x2 main image. cjxl does not emit previews.
function previewFile(): Uint8Array {
  const { codestream: main } = extractCodestream(bytes('orientation1'));
  const br = new JxlBitReader(main);
  readImageHeader(br);
  const preview = writeJxl(
    { width: 1, height: 1, data: new Float32Array([1, 0, 0, 1]), linearColorSpace: 'linear-rec709' },
    { bitDepth: 'float32' },
  );
  const pbr = new JxlBitReader(preview);
  readImageHeader(pbr);
  const w = new JxlBitWriter();
  w.writeBits(16, 0x0aff);
  writeSizeHeader(w, 3, 2);
  w.writeBool(false); // metadata all_default
  w.writeBool(true); // extra_fields
  w.writeBits(3, 0); // orientation
  w.writeBool(false); // intrinsic size
  w.writeBool(true); // preview
  w.writeBool(false); // preview dimensions not divisible by 8
  w.writeBits(2, 0);
  w.writeBits(6, 0); // preview height = 1
  w.writeBits(3, 1); // square aspect ratio
  w.writeBool(false); // animation
  writeBitDepth(w, { float: true, bitsPerSample: 32, expBits: 8 });
  w.writeBool(false); // modular 16-bit buffer
  w.writeU32(0, 0, 1, { bits: 4, offset: 2 }, { bits: 12, offset: 1 });
  w.writeBool(false); // non-XYB
  w.writeBool(false);
  w.writeBool(false); // colour all_default, want_icc
  w.writeEnum(0);
  w.writeEnum(1);
  w.writeEnum(1); // RGB, D65, sRGB primaries
  w.writeBool(false);
  w.writeEnum(8);
  w.writeEnum(1); // linear, relative intent
  w.writeBool(true); // tone mapping defaults
  w.writeU64(0); // extensions
  w.writeBool(true); // custom transform defaults
  w.zeroPadToByte();
  w.writeBytes(preview.subarray(pbr.byteOffset));
  w.writeBytes(main.subarray(br.byteOffset));
  return w.finish();
}

describe('JPEG XL decoder gaps', () => {
  it('writes the crafted preview fixture when requested', () => {
    const outDir = process.env.JXL_CRAFT_OUT;
    if (outDir) fs.writeFileSync(`${outDir}/preview.jxl`, previewFile());
  });
  it('skips a separately sized preview and returns the unchanged main image', () => {
    const file = previewFile();
    const expected = readJxl(bytes('orientation1'));
    expected.metadata!.container = false;
    expect(readJxl(file)).toEqual(expected);
    expect(readJxlFrames(file).frames[0].image).toEqual(expected);
    const ref = readPfm('features/preview.ref.pfm');
    for (let i = 0; i < 6; i++)
      for (let c = 0; c < 3; c++) expect(expected.data[i * 4 + c]).toBe(ref.samples[i * 3 + c]);
  });

  for (let orientation = 1; orientation <= 8; orientation++) {
    it(`applies orientation ${orientation} exactly like djxl, with an opt-out`, () => {
      const out = readJxl(bytes(`orientation${orientation}`));
      const ref = readPfm(`features/orientation${orientation}.ref.pfm`);
      expect([out.width, out.height]).toEqual([ref.width, ref.height]);
      for (let i = 0; i < out.width * out.height; i++) {
        expect(Array.from(out.data.subarray(i * 4, i * 4 + 3))).toEqual(
          Array.from(ref.samples.subarray(i * 3, i * 3 + 3)),
        );
      }
      const raw = readJxl(bytes(`orientation${orientation}`), { applyOrientation: false });
      expect([raw.width, raw.height]).toEqual([3, 2]);
      expect(raw.data).toEqual(readJxl(bytes('orientation1')).data);
      expect(raw.metadata?.orientation).toBe(orientation);
    });
  }

  it('unpremultiplies associated alpha, including tiny and zero alpha, with an opt-out', () => {
    const file = bytes('associated_alpha');
    const straight = readJxl(file);
    const associated = readJxl(file, { keepPremultipliedAlpha: true });
    expect(straight.metadata?.alphaPremultiplied).toBe(false);
    expect(associated.metadata?.alphaPremultiplied).toBe(true);
    const ref = readPfm('features/associated_alpha.ref.pfm');
    for (let i = 0; i < 6; i++)
      for (let c = 0; c < 3; c++) {
        expect(straight.data[i * 4 + c]).toBeCloseTo(ref.samples[i * 3 + c], 6);
        expect(straight.data[i * 4 + c]).toBeCloseTo(
          associated.data[i * 4 + c] / Math.max(associated.data[i * 4 + 3], 2 ** -26),
          6,
        );
      }
  });

  it('retains named depth and selection mask samples in display orientation', () => {
    const image = readJxl(bytes('extra_channels'));
    const channels = image.metadata?.extraChannels as JxlExtraChannel[];
    expect(channels.map(({ name, type, width, height }) => ({ name, type, width, height }))).toEqual([
      { name: 'Z', type: 'depth', width: 2, height: 3 },
      { name: 'selection', type: 'selectionMask', width: 2, height: 3 },
    ]);
    expect(Array.from(channels[0].data)).toEqual([3, 0, 4, 1, 5, 2]);
    expect(Array.from(channels[1].data)).toEqual([0, 1, 1, 0, 0, 1]);
    const raw = readJxl(bytes('extra_channels'), { applyOrientation: false });
    expect(Array.from((raw.metadata!.extraChannels as JxlExtraChannel[])[0].data)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('optionally renders spot colours like djxl and retains ink samples and metadata', () => {
    const file = bytes('spot_color');
    const raw = readJxl(file);
    const rendered = readJxl(file, { renderSpotColors: true });
    const ref = readPfm('features/spot_color.ref.pfm');
    const channels = rendered.metadata!.extraChannels as JxlExtraChannel[];
    expect(channels[0].name).toBe('ink');
    expect(channels[0].type).toBe('spotColor');
    expect(channels[0].spotColor).toEqual([0.25, 0.75, 0.5, 0.625]);
    expect(Array.from(channels[0].data)).toEqual([0, 0.25, 0.5, 0.75, 1, 0.125]);
    for (let i = 0; i < 6; i++)
      for (let c = 0; c < 3; c++) {
        expect(rendered.data[i * 4 + c]).toBeCloseTo(ref.samples[i * 3 + c], 6);
        expect(raw.data[i * 4 + c]).toBe((i + 1 + c) / 16);
      }
    expect(readJxlFrames(file, { renderSpotColors: true }).frames[0].image.data).toEqual(rendered.data);
  });

  it('returns every animation frame, with pixels matching coalesced djxl references', () => {
    const { frames, numLoops } = readJxlFrames(bytes('anim_gif'));
    expect(numLoops).toBe(0);
    expect(frames.map((f) => f.duration)).toEqual([0.1, 0.1, 0.1]);
    for (let frame = 0; frame < 3; frame++) {
      const ref = readPnm(`features/anim_gif.ref${frame}.pam`);
      const image = frames[frame].image;
      expect([image.width, image.height]).toEqual([ref.width, ref.height]);
      for (let i = 0; i < image.data.length; i++) {
        const sample = i % 4 === 3 ? image.data[i] : linearTosRGB(image.data[i]);
        expect(sample * ref.maxval).toBeCloseTo(ref.samples[i], 3);
      }
    }
    const second = frames[1].image.data.slice();
    frames[0].image.data.fill(0);
    expect(frames[1].image.data).toEqual(second);
  });

  it('combines Rec.2020, rotation, associated alpha and animation against djxl', () => {
    const file = bytes('widegamut_animation');
    const associated = readJxlFrames(file, { keepPremultipliedAlpha: true });
    const straight = readJxlFrames(file);
    expect(associated.numLoops).toBe(3);
    expect(associated.frames.map((frame) => frame.duration)).toEqual([0.025, 0.1, 0.25]);
    expect(associated.frames.map((frame) => frame.timecode)).toEqual([0x01020304, 0x01020305, 0x01020306]);
    for (let frame = 0; frame < 3; frame++) {
      const image = associated.frames[frame].image;
      const ref = readPfm(`features/widegamut_animation.ref${frame}.pfm`);
      expect([image.width, image.height, image.linearColorSpace]).toEqual([2, 3, 'linear-rec2020']);
      expect(image.metadata).toMatchObject({ orientation: 6, alphaPremultiplied: true });
      for (let i = 0; i < 6; i++) {
        const alpha = image.data[i * 4 + 3];
        expect(straight.frames[frame].image.data[i * 4 + 3]).toBe(alpha);
        for (let c = 0; c < 3; c++) {
          expect(image.data[i * 4 + c]).toBe(ref.samples[i * 3 + c]);
          expect(straight.frames[frame].image.data[i * 4 + c]).toBeCloseTo(
            image.data[i * 4 + c] / Math.max(alpha, 2 ** -26),
            6,
          );
        }
      }
    }
    expect(readJxl(file, { keepPremultipliedAlpha: true }).data).toEqual(associated.frames[0].image.data);
    const stored = readJxlFrames(file, { applyOrientation: false, keepPremultipliedAlpha: true });
    expect([stored.frames[0].image.width, stored.frames[0].image.height]).toEqual([3, 2]);
    expect(Array.from(stored.frames[0].image.data).filter((_, i) => i % 4 === 3)).toEqual([
      0,
      Math.fround(1e-7),
      Math.fround(0.4),
      Math.fround(0.6),
      Math.fround(0.8),
      1,
    ]);
  });

  it('returns nonuniform durations, timecodes, loop count and still images', () => {
    const { frames, numLoops } = readJxlFrames(bytes('animation_timing'));
    expect(numLoops).toBe(3);
    expect(frames.map((f) => f.duration)).toEqual([0.025, 0.1, 0.25]);
    expect(frames.map((f) => f.timecode)).toEqual([0x01020304, 0x01020305, 0x01020306]);
    expect(readJxl(bytes('animation_timing')).metadata?.animation).toEqual({
      frameCount: 3,
      frameDurations: [0.025, 0.1, 0.25],
      numLoops: 3,
    });
    const still = readJxlFrames(bytes('orientation1'));
    expect(still.numLoops).toBe(0);
    expect(still.frames).toHaveLength(1);
    expect(still.frames[0].duration).toBe(0);
  });
});
