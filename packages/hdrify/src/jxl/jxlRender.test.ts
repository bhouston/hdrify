import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JxlBitReader } from './jxlBitReader.js';
import { extractCodestream } from './jxlContainer.js';
import { type JxlBlendingInfo, type JxlFrameHeader, readFrameHeader } from './jxlFrameHeader.js';
import { type JxlExtraChannelInfo, type JxlImageHeader, readImageHeader } from './jxlImageHeader.js';
import {
  advanceFrameIndices,
  blendFrame,
  blendPixels,
  canBeReferenced,
  isDisplayedFrame,
  type JxlReferenceFrame,
  needsBlending,
  PATCH_ALPHA_WEIGHTED_ADD_BELOW,
  PATCH_BLEND_BELOW,
  PATCH_NONE,
  saveReference,
  staysLinear,
  upsampleFrame,
} from './jxlRender.js';
import { ASSETS, readPnm } from './jxlTestAssets.js';
import { upsamplePlane } from './jxlUpsample.js';
import { writeJxl } from './writeJxl.js';
import { decodeDisplayedFrames } from './readJxl.js';

const alpha = (alphaAssociated = false, dimShift = 0): JxlExtraChannelInfo => ({
  type: 'alpha',
  bitDepth: { floatSample: false, bitsPerSample: 8, expBits: 0 },
  dimShift,
  name: '',
  alphaAssociated,
});
const depth = (): JxlExtraChannelInfo => ({ ...alpha(), type: 'depth' });

function imageHeader(width: number, height: number, extraChannels: JxlExtraChannelInfo[] = []): JxlImageHeader {
  const img = { width: 4, height: 4, data: new Float32Array(64), linearColorSpace: 'linear-rec709' as const };
  return { ...readImageHeader(new JxlBitReader(writeJxl(img))), width, height, extraChannels };
}

const bi = (mode: JxlBlendingInfo['mode'], o: Partial<JxlBlendingInfo> = {}): JxlBlendingInfo => ({
  mode,
  alphaChannel: 0,
  clamp: false,
  source: 0,
  ...o,
});

function frameHeader(image: JxlImageHeader, o: Partial<JxlFrameHeader> = {}): JxlFrameHeader {
  return { ...readFrameHeader(new JxlBitReader(new Uint8Array([1])), image), ...o };
}

/** A w x h frame whose channel c holds the constant values[c]. */
const solid = (w: number, h: number, values: number[], extra: Partial<JxlReferenceFrame> = {}): JxlReferenceFrame => ({
  width: w,
  height: h,
  planes: values.map((v) => new Float32Array(w * h).fill(v)),
  ...extra,
});

/** Blend one pixel: background `b`, foreground `f` (per channel), returning the composite. */
function blend1(fh: JxlFrameHeader, image: JxlImageHeader, b: number[], f: number[]): number[] {
  const out = blendFrame(solid(1, 1, f), fh, image, [solid(1, 1, b)]);
  return out.planes.map((p) => p[0]);
}

describe('blendFrame blend modes (1x1, alpha in extra channel 0)', () => {
  const image = imageHeader(1, 1, [alpha()]);
  const fh = (mode: JxlBlendingInfo['mode'], o: Partial<JxlBlendingInfo> = {}, ec = bi('replace')) =>
    frameHeader(image, { blendingInfo: bi(mode, o), ecBlendingInfo: [ec] });
  const bg = [0.2, 0.4, 0.6, 0.5];
  const fg = [0.8, 0.1, 1.5, 0.25];

  it('replace without crop needs no blending and returns the frame itself', () => {
    const f = solid(1, 1, fg);
    expect(needsBlending(fh('replace'))).toBe(false);
    expect(blendFrame(f, fh('replace'), image, [solid(1, 1, bg)])).toBe(f);
  });

  it('add / mul (with and without clamp)', () => {
    const add = blend1(fh('add'), image, bg, fg);
    for (let c = 0; c < 3; c++) expect(add[c]).toBeCloseTo(bg[c] + fg[c], 6);
    expect(add[3]).toBeCloseTo(fg[3], 6); // alpha: its own (replace) blending
    const mul = blend1(fh('mul'), image, bg, fg);
    expect(mul[2]).toBeCloseTo(0.6 * 1.5, 6);
    expect(blend1(fh('mul', { clamp: true }), image, bg, fg)[2]).toBeCloseTo(0.6, 6);
  });

  it('blend: straight alpha "over", alpha = union, extra channel alpha blended too', () => {
    const out = blend1(fh('blend', {}, bi('blend')), image, bg, fg);
    const na = 1 - (1 - 0.25) * (1 - 0.5);
    for (let c = 0; c < 3; c++) expect(out[c]).toBeCloseTo((fg[c] * 0.25 + bg[c] * 0.5 * 0.75) / na, 6);
    expect(out[3]).toBeCloseTo(na, 6);
    // The color blend writes the alpha channel even when its own blending is replace (libjxl order).
    expect(blend1(fh('blend'), image, bg, fg)[3]).toBeCloseTo(na, 6);
  });

  it('blend with premultiplied alpha and clamping of alpha > 1', () => {
    const pm = imageHeader(1, 1, [alpha(true)]);
    const f = frameHeader(pm, { blendingInfo: bi('blend'), ecBlendingInfo: [bi('blend')] });
    const out = blend1(f, pm, bg, fg);
    for (let c = 0; c < 3; c++) expect(out[c]).toBeCloseTo(fg[c] + bg[c] * 0.75, 6);
    const over = [0.8, 0.1, 1.5, 1.5];
    const clamped = frameHeader(pm, { blendingInfo: bi('blend', { clamp: true }), ecBlendingInfo: [bi('blend')] });
    expect(blend1(clamped, pm, bg, over)[0]).toBeCloseTo(0.8, 6); // fa clamped to 1: bg vanishes
    expect(blend1(f, pm, bg, over)[0]).toBeCloseTo(0.8 + 0.2 * -0.5, 6);
  });

  it('mulAdd: bg + fg * alpha (alpha channel itself keeps the background)', () => {
    const out = blend1(fh('mulAdd', {}, bi('mulAdd')), image, bg, fg);
    for (let c = 0; c < 3; c++) expect(out[c]).toBeCloseTo(bg[c] + fg[c] * 0.25, 6);
    expect(out[3]).toBeCloseTo(0.5, 6);
    const hi = [0.8, 0.1, 1.5, 2];
    expect(blend1(fh('mulAdd', { clamp: true }), image, bg, hi)[0]).toBeCloseTo(0.2 + 0.8, 6);
  });

  it('without an alpha channel, blend copies the frame and mulAdd adds', () => {
    const img = imageHeader(1, 1, [depth()]);
    const f = (mode: JxlBlendingInfo['mode']) =>
      frameHeader(img, { blendingInfo: bi(mode), ecBlendingInfo: [bi('replace')] });
    expect(blend1(f('blend'), img, bg, fg).slice(0, 3)).toEqual(fg.slice(0, 3).map(Math.fround));
    expect(blend1(f('mulAdd'), img, bg, fg)[0]).toBeCloseTo(1, 6);
  });

  it('selects the alpha channel and per-channel sources', () => {
    const img = imageHeader(1, 1, [depth(), alpha()]);
    const f = frameHeader(img, {
      blendingInfo: bi('blend', { alphaChannel: 1 }),
      ecBlendingInfo: [bi('add', { source: 2 }), bi('blend', { alphaChannel: 1 })],
    });
    const refs = [solid(1, 1, [0.2, 0.4, 0.6, 9, 0.5]), undefined, solid(1, 1, [0, 0, 0, 3, 0])];
    const out = blendFrame(solid(1, 1, [0.8, 0.1, 1.5, 7, 0.25]), f, img, refs).planes.map((p) => p[0]);
    const na = 1 - 0.75 * 0.5;
    expect(out[0]).toBeCloseTo((0.8 * 0.25 + 0.2 * 0.5 * 0.75) / na, 6);
    expect(out[3]).toBe(3 + 7); // depth: add onto slot 2's depth
    expect(out[4]).toBeCloseTo(na, 6);
  });

  it('patch-only modes: blendBelow, alphaWeightedAddBelow, none', () => {
    const ec = [alpha()];
    const run = (mode: number) => {
      const out = [0, 1, 2, 3].map(() => new Float32Array(1));
      const b = bg.map((v) => Float32Array.of(v));
      const f = fg.map((v) => Float32Array.of(v));
      const blending = [0, 1].map(() => ({ mode, alphaChannel: 0, clamp: false }));
      blendPixels(b, 0, f, 0, out, 0, 1, blending, ec, new Float32Array(4));
      return out.map((p) => p[0]);
    };
    const below = run(PATCH_BLEND_BELOW); // background drawn over the patch
    const na = 1 - (1 - 0.5) * (1 - 0.25);
    expect(below[0]).toBeCloseTo((0.2 * 0.5 + 0.8 * 0.25 * 0.5) / na, 6);
    expect(below[3]).toBeCloseTo(na, 6);
    const awaBelow = run(PATCH_ALPHA_WEIGHTED_ADD_BELOW);
    expect(awaBelow[0]).toBeCloseTo(0.8 + 0.2 * 0.5, 6);
    expect(awaBelow[3]).toBeCloseTo(0.25, 6);
    expect(run(PATCH_NONE)).toEqual(bg.map(Math.fround));
  });
});

describe('blendFrame placement', () => {
  const image = imageHeader(5, 4);
  const crop = (x0: number, y0: number, w: number, h: number, mode: JxlBlendingInfo['mode'] = 'replace') =>
    frameHeader(image, { haveCrop: true, x0, y0, width: w, height: h, blendingInfo: bi(mode, { source: 1 }) });

  it('places a cropped frame at its offset over the background slot', () => {
    const frame: JxlReferenceFrame = { width: 2, height: 2, planes: [0, 1, 2].map(() => Float32Array.of(1, 2, 3, 4)) };
    const out = blendFrame(frame, crop(2, 1, 2, 2), image, [undefined, solid(5, 4, [9, 9, 9])]);
    expect([out.width, out.height]).toEqual([5, 4]);
    expect(Array.from(out.planes[0])).toEqual([9, 9, 9, 9, 9, 9, 9, 1, 2, 9, 9, 9, 3, 4, 9, 9, 9, 9, 9, 9]);
  });

  it('crops frames hanging off any edge; an empty slot is black', () => {
    const frame: JxlReferenceFrame = {
      width: 3,
      height: 3,
      planes: [0, 1, 2].map(() => Float32Array.from({ length: 9 }, (_, i) => i + 1)),
    };
    const tl = blendFrame(frame, crop(-1, -2, 3, 3), image, []);
    expect(Array.from(tl.planes[1].subarray(0, 5))).toEqual([8, 9, 0, 0, 0]);
    expect(tl.planes[1].subarray(5).every((v) => v === 0)).toBe(true);
    const br = blendFrame(frame, crop(4, 3, 3, 3, 'add'), image, [undefined, solid(5, 4, [10, 10, 10])]);
    expect(br.planes[2][19]).toBe(11);
    expect(br.planes[2][18]).toBe(10);
    const away = blendFrame(frame, crop(7, 0, 3, 3), image, [undefined, solid(5, 4, [5, 5, 5])]);
    expect(away.planes[0].every((v) => v === 5)).toBe(true);
  });

  it('does not modify the background reference', () => {
    const bgRef = solid(5, 4, [1, 1, 1]);
    blendFrame(solid(5, 4, [3, 3, 3]), crop(0, 0, 5, 4, 'add'), image, [undefined, bgRef]);
    expect(bgRef.planes[0].every((v) => v === 1)).toBe(true);
  });

  it('rejects backgrounds saved before the color transform or of the wrong size', () => {
    const f = solid(2, 2, [0, 0, 0]);
    expect(() =>
      blendFrame(f, crop(0, 0, 2, 2), image, [undefined, solid(5, 4, [0, 0, 0], { savedBeforeCt: true })]),
    ).toThrow(/before color transform/);
    expect(() => blendFrame(f, crop(0, 0, 2, 2), image, [undefined, solid(2, 2, [0, 0, 0])])).toThrow(/image-sized/);
  });
});

describe('frame bookkeeping', () => {
  const image = imageHeader(2, 2);
  it('canBeReferenced / isDisplayedFrame / advanceFrameIndices follow libjxl', () => {
    const last = frameHeader(image, { isLast: true });
    const anim = frameHeader(image, { isLast: false, duration: 5, saveAsReference: 0 });
    const zero = frameHeader(image, { isLast: false, duration: 0 });
    const refOnly = frameHeader(image, { frameType: 'referenceOnly', isLast: false, saveAsReference: 3 });
    const lf = frameHeader(image, { frameType: 'lf', isLast: false });
    expect([last, anim, zero, refOnly, lf].map(canBeReferenced)).toEqual([false, false, true, true, false]);
    expect([last, anim, zero, refOnly, lf].map(isDisplayedFrame)).toEqual([true, true, false, false, false]);
    const idx = { visible: 0, nonvisible: 0 };
    for (const fh of [refOnly, zero, anim, zero, last]) advanceFrameIndices(idx, fh);
    expect(idx).toEqual({ visible: 2, nonvisible: 0 });
    advanceFrameIndices(idx, refOnly);
    expect(idx).toEqual({ visible: 2, nonvisible: 1 });
  });

  it('saveReference stores the canvas, or a copy of the pre-color-transform frame', () => {
    const refs: (JxlReferenceFrame | undefined)[] = [];
    const before = solid(1, 1, [1, 2, 3]);
    const canvas = solid(2, 2, [4, 5, 6]);
    saveReference(refs, frameHeader(image, { isLast: false, saveAsReference: 2 }), before, canvas);
    expect(refs[2]).toBe(canvas);
    saveReference(refs, frameHeader(image, { isLast: false, saveAsReference: 1, saveBeforeCt: true }), before, canvas);
    expect(refs[1]!.savedBeforeCt).toBe(true);
    before.planes[0][0] = 99;
    expect(refs[1]!.planes[0][0]).toBe(1);
    saveReference(refs, frameHeader(image, { isLast: true, saveAsReference: 0 }), before, canvas);
    expect(refs[0]).toBeUndefined();
  });

  it('staysLinear matches libjxl: from-linear only for blending or post-colour-transform references', () => {
    const ref = { isLast: false, duration: 5, saveAsReference: 1 };
    const cases = [
      frameHeader(image, { isLast: true }),
      frameHeader(image, ref),
      frameHeader(image, { ...ref, saveBeforeCt: true }),
      frameHeader(image, { ...ref, saveBeforeCt: true, haveCrop: true }),
      frameHeader(image, { isLast: true, blendingInfo: bi('add') }),
    ];
    expect(cases.map(staysLinear)).toEqual([true, false, true, false, false]);
  });
});

const ramp = (w: number, h: number) =>
  Float32Array.from({ length: w * h }, (_, i) => (i % w) * 0.1 + Math.floor(i / w));

describe('upsampleFrame', () => {
  it('upsamples a dimShift extra channel early (upsampling 1), cropped to the odd frame size', () => {
    const image = imageHeader(5, 3, [alpha(false, 1)]);
    const fh = frameHeader(image, { width: 5, height: 3 });
    const ec = ramp(3, 2);
    const color = [0, 1, 2].map(() => ramp(5, 3));
    const early = upsampleFrame([...color, ec], fh, image, 'early');
    expect(early[0]).toBe(color[0]);
    const full = upsamplePlane(ec, 3, 2, 2, image.upsampling2Weights);
    expect(early[3].length).toBe(15);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) expect(early[3][y * 5 + x]).toBe(full[y * 6 + x]);
    const late = upsampleFrame(early, fh, image, 'late');
    expect(late[3]).toBe(early[3]);
    expect(late[0]).toBe(color[0]);
  });

  it('defers extra channels to the late stage when they match the color upsampling, with custom weights', () => {
    const image = imageHeader(8, 4, [alpha()]);
    image.upsampling2Weights = image.upsampling2Weights.map((w, i) => (i === 9 ? w + 0.05 : w));
    const fh = frameHeader(image, { width: 8, height: 4, upsampling: 2, ecUpsampling: [2] });
    const planes = [0, 1, 2, 3].map(() => ramp(4, 2));
    const early = upsampleFrame(planes, fh, image, 'early');
    expect(early[3]).toBe(planes[3]);
    const late = upsampleFrame(early, fh, image, 'late');
    const expected = upsamplePlane(planes[0], 4, 2, 2, image.upsampling2Weights);
    for (const p of late) expect(p).toEqual(expected);
    expect(expected).not.toEqual(upsamplePlane(planes[0], 4, 2, 2));
  });

  it('mixed factors: color x2 late, extra channel x4 early to full resolution', () => {
    const image = imageHeader(8, 8, [alpha()]);
    const fh = frameHeader(image, { width: 8, height: 8, upsampling: 2, ecUpsampling: [4] });
    const early = upsampleFrame([ramp(4, 4), ramp(4, 4), ramp(4, 4), ramp(2, 2)], fh, image, 'early');
    expect(early[3].length).toBe(64);
    expect(early[0].length).toBe(16);
    const late = upsampleFrame(early, fh, image, 'late');
    expect(late.map((p) => p.length)).toEqual([64, 64, 64, 64]);
    expect(late[3]).toBe(early[3]);
  });
});

describe('animation oracle (cjxl from an optimized GIF: cropped, alpha-blended frames)', () => {
  it('composites every displayed frame exactly like djxl --output_frames', () => {
    const { codestream } = extractCodestream(new Uint8Array(fs.readFileSync(new URL('features/anim_gif.jxl', ASSETS))));
    const br = new JxlBitReader(codestream);
    const image = readImageHeader(br);
    expect(image.animation).toBeDefined();
    let shown = 0;
    let cropped = 0;
    for (const { canvas, fh } of decodeDisplayedFrames(codestream, image, br.byteOffset)) {
      cropped += fh.haveCrop ? 1 : 0;
      const ref = readPnm(`features/anim_gif.ref${shown++}.pam`);
      expect(ref.channels).toBe(4);
      let maxErr = 0;
      for (let i = 0; i < ref.width * ref.height; i++) {
        for (let c = 0; c < 4; c++) {
          maxErr = Math.max(maxErr, Math.abs(canvas.planes[c][i] * 255 - ref.samples[i * 4 + c]));
        }
      }
      expect(maxErr).toBeLessThan(0.5);
    }
    expect(shown).toBe(3);
    expect(cropped).toBe(2);
  });
});
