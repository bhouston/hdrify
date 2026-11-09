/** Fixed-decision JPEG XL encoder: XYB, DCT8, one pass and uniform quantization.
 * Larger transforms, adaptive quantization and restoration filters are deliberately
 * left to future effort modes. The stream uses the standard library dequant tables.
 */
import { convertLinearColorSpace } from '../color/convert.js';
import { decodeFloat16, encodeFloat16 } from '../exr/halfFloat.js';
import type { HdrifyImage } from '../hdrifyImage.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import { JxlEncEntropyCode, packSigned, type TokenStream } from './jxlEncEntropy.js';
import {
  jxlIntensityTarget,
  type JxlEncBitDepth,
  type JxlEncLayout,
  writeFrameHeader,
  writeImageMetadata,
  writeSizeHeader,
  writeToc,
  wrapJxlContainer,
} from './jxlEncHeaders.js';
import { clampedGradient } from './jxlPredictors.js';
import { nonZeroContext, zeroDensityContext } from './jxlVardctDecode.js';
import {
  computeDefaultDequantMatrices,
  dequantMatrixFor,
  hfDequantMultiplier,
  lfDequantScale,
  JXL_DEFAULT_M_LF,
} from './jxlVardctDequant.js';
import { forwardDct2d, naturalCoeffOrder } from './jxlVardctTransforms.js';
import { JXL_OPSIN_ABSORBANCE_MATRIX } from './jxlXyb.js';
import type { WriteJxlOptions } from './writeJxl.js';

interface Plane {
  data: Int32Array;
  width: number;
  height: number;
}

/** A local, single-leaf Gradient Modular stream, used for LF, metadata and alpha. */
function writeModular(w: JxlBitWriter, planes: Plane[], headerOnly = false): void {
  if (!planes.length) return;
  w.writeBool(false); // local tree
  w.writeBool(true); // default weighted-predictor header
  w.writeU32(0, 0, 1, { bits: 4, offset: 2 }, { bits: 8, offset: 18 }); // no transforms
  if (headerOnly) return;
  const tree: TokenStream = { contexts: [1, 2, 3, 4, 5], values: [0, 5, 0, 0, 0] };
  const treeCode = JxlEncEntropyCode.build(6, [tree]);
  treeCode.writeHeader(w);
  treeCode.writeStream(w, tree);
  let size = 0;
  for (const plane of planes) size += plane.data.length;
  const values = new Float64Array(size);
  let i = 0;
  for (const { data, width, height } of planes) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const left = x ? data[p - 1]! : y ? data[p - width]! : 0;
        const top = y ? data[p - width]! : left;
        const topLeft = x && y ? data[p - width - 1]! : left;
        values[i++] = packSigned((data[p]! - clampedGradient(left, top, topLeft)) | 0);
      }
    }
  }
  const stream = { contexts: new Uint8Array(size), values };
  const code = JxlEncEntropyCode.build(1, [stream]);
  code.writeHeader(w);
  code.writeStream(w, stream);
}

function rect(plane: Int32Array, stride: number, x0: number, y0: number, width: number, height: number): Plane {
  const data = new Int32Array(width * height);
  for (let y = 0; y < height; y++)
    data.set(plane.subarray((y0 + y) * stride + x0, (y0 + y) * stride + x0 + width), y * width);
  return { data, width, height };
}

const ceilLog2 = (n: number): number => (n <= 1 ? 0 : 32 - Math.clz32(n - 1));

export function writeVardctJxl(
  image: HdrifyImage,
  options: WriteJxlOptions,
  bitDepth: JxlEncBitDepth,
  layout: JxlEncLayout,
  ecPlanes: Int32Array[],
): Uint8Array {
  const distance = options.distance ?? 1;
  if (!Number.isFinite(distance) || distance <= 0 || distance > 25)
    throw new Error('writeJxl: distance must be > 0 and <= 25');
  const { width, height } = image;
  const bw = Math.ceil(width / 8),
    bh = Math.ceil(height / 8);
  let source = image;
  if (!bitDepth.float || bitDepth.bitsPerSample === 16) {
    const data = image.data.slice();
    const max = 2 ** bitDepth.bitsPerSample - 1;
    for (let i = 0; i < data.length; i++) {
      if ((i & 3) === 3) continue;
      const value = data[i]!;
      data[i] = bitDepth.float
        ? decodeFloat16(encodeFloat16(value))
        : Math.round(Math.max(0, Math.min(1, value)) * max) / max;
    }
    source = { ...image, data };
  }
  const rgb = convertLinearColorSpace(source, 'linear-rec709').data;
  const intensityTarget = jxlIntensityTarget(image);
  // XYB is absolute: libjxl scales linear input by intensity_target / 255 before the opsin matrix.
  const m = JXL_OPSIN_ABSORBANCE_MATRIX.map((v) => (v * intensityTarget) / 255);
  const globalScale = Math.max(1, Math.min(73728, Math.round(4096 / distance)));
  const quantLf = 16,
    hfMul = 64;
  const matrices = computeDefaultDequantMatrices();
  const lf = [0, 1, 2].map(() => new Int32Array(bw * bh));
  const ac = [0, 1, 2].map(() => new Int32Array(bw * bh * 64));
  const block = [0, 1, 2].map(() => new Float32Array(64));
  const bias = 0.0037930732552754493;
  const biasRoot = Math.cbrt(bias);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const p = (Math.min(height - 1, by * 8 + y) * width + Math.min(width - 1, bx * 8 + x)) * 4;
          const r = rgb[p]!,
            g = layout.grey ? r : rgb[p + 1]!,
            b = layout.grey ? r : rgb[p + 2]!;
          const l = Math.cbrt(m[0]! * r + m[1]! * g + m[2]! * b + bias) - biasRoot;
          const mm = Math.cbrt(m[3]! * r + m[4]! * g + m[5]! * b + bias) - biasRoot;
          const s = Math.cbrt(m[6]! * r + m[7]! * g + m[8]! * b + bias) - biasRoot;
          block[0]![y * 8 + x] = (l - mm) / 2;
          block[1]![y * 8 + x] = (l + mm) / 2;
          block[2]![y * 8 + x] = s;
        }
      }
      for (const b of block) forwardDct2d(b, 8, 8);
      // Default chroma-from-luma predicts B from Y, both in LF and HF.
      for (let k = 0; k < 64; k++) block[2]![k] = block[2]![k]! - block[1]![k]!;
      const o = by * bw + bx;
      for (let c = 0; c < 3; c++) {
        const matrix = dequantMatrixFor(matrices, 0, c);
        const scale = hfDequantMultiplier(globalScale, hfMul, c, c === 0 ? 3 : 2);
        const dc = Math.round(block[c]![0]! / lfDequantScale(JXL_DEFAULT_M_LF[c]!, globalScale, quantLf));
        if (!Number.isFinite(dc) || Math.abs(dc) > 0x7fffffff)
          throw new Error('writeJxl: lossy sample exceeds coefficient range');
        lf[c]![o] = dc;
        for (let k = 1; k < 64; k++) {
          const v = Math.round(block[c]![k]! / (matrix[k]! * scale));
          if (!Number.isFinite(v) || Math.abs(v) > 0x7fffffff)
            throw new Error('writeJxl: lossy sample exceeds coefficient range');
          ac[c]![o * 64 + k] = v;
        }
      }
    }
  }
  const groupsX = Math.ceil(width / 256),
    groupsY = Math.ceil(height / 256);
  const numGroups = groupsX * groupsY;
  const lfGroupsX = Math.ceil(bw / 256),
    lfGroupsY = Math.ceil(bh / 256);
  const single = numGroups === 1;
  const streams: TokenStream[] = [];
  const order = naturalCoeffOrder(0);
  for (let gy = 0; gy < groupsY; gy++) {
    for (let gx = 0; gx < groupsX; gx++) {
      const gw = Math.min(32, bw - gx * 32),
        gh = Math.min(32, bh - gy * 32);
      const nzGrid = [0, 1, 2].map(() => new Uint8Array(gw * gh));
      const contexts: number[] = [],
        values: number[] = [];
      const push = (ctx: number, v: number): void => {
        contexts.push(ctx);
        values.push(v);
      };
      for (let by = 0; by < gh; by++) {
        for (let bx = 0; bx < gw; bx++) {
          const o = (gy * 32 + by) * bw + gx * 32 + bx;
          for (const c of [1, 0, 2]) {
            const coeffs = ac[c]!;
            let nz = 0;
            for (let k = 1; k < 64; k++) if (coeffs[o * 64 + k] !== 0) nz++;
            const grid = nzGrid[c]!,
              gi = by * gw + bx;
            const predicted =
              bx === 0
                ? by === 0
                  ? 32
                  : grid[gi - gw]!
                : by === 0
                  ? grid[gi - 1]!
                  : (grid[gi - 1]! + grid[gi - gw]! + 1) >> 1;
            grid[gi] = nz;
            push(nonZeroContext(predicted, 0, 1), nz);
            let prev = nz > 4 ? 0 : 1;
            for (let k = 1; k < 64 && nz > 0; k++) {
              // Square DCT8 uses the transposed natural order in pixel orientation.
              const q = coeffs[o * 64 + order[k * 2]! * 8 + order[k * 2 + 1]!]!;
              push(37 + zeroDensityContext(nz, k, 0, prev), packSigned(q));
              prev = q ? 1 : 0;
              if (q) nz--;
            }
          }
        }
      }
      streams.push({ contexts, values });
    }
  }
  // Three HF histograms: nonzero counts, then coefficients conditioned on the previous nonzero.
  const contextMap = Uint8Array.from({ length: 495 }, (_, ctx) => (ctx < 37 ? 0 : 1 + ((ctx - 37) & 1)));
  const hfCode = JxlEncEntropyCode.build(495, streams, contextMap);
  const sections: JxlBitWriter[] = [new JxlBitWriter()];
  const global = sections[0]!;
  global.writeBool(true); // default LF dequantization
  global.writeU32(
    globalScale,
    { bits: 11, offset: 1 },
    { bits: 11, offset: 2049 },
    { bits: 12, offset: 4097 },
    { bits: 16, offset: 8193 },
  );
  global.writeU32(quantLf, 16, { bits: 5, offset: 1 }, { bits: 8, offset: 1 }, { bits: 16, offset: 1 });
  global.writeBool(false); // custom block context: all blocks share cluster 0
  for (let i = 0; i < 4; i++) global.writeBits(4, 0); // no LF or quant field thresholds
  global.writeBool(true);
  global.writeBits(2, 0); // 39-entry constant block context map
  global.writeBool(true); // default CfL
  global.writeBool(false); // no global Modular tree
  writeModular(
    global,
    ecPlanes.map((data) => ({ data, width, height })),
    !single,
  );
  for (let ly = 0; ly < lfGroupsY; ly++) {
    for (let lx = 0; lx < lfGroupsX; lx++) {
      const w = single ? global : new JxlBitWriter();
      if (!single) sections.push(w);
      const gw = Math.min(256, bw - lx * 256),
        gh = Math.min(256, bh - ly * 256);
      w.writeBits(2, 0); // LF extra precision
      writeModular(
        w,
        [1, 0, 2].map((c) => rect(lf[c]!, bw, lx * 256, ly * 256, gw, gh)),
      );
      const n = gw * gh,
        tw = Math.ceil(gw / 8),
        th = Math.ceil(gh / 8);
      w.writeBits(ceilLog2(n), n - 1); // one DCT8 per 8x8 block
      const strategies = new Int32Array(n * 2);
      strategies.fill(hfMul - 1, n);
      writeModular(w, [
        { data: new Int32Array(tw * th), width: tw, height: th },
        { data: new Int32Array(tw * th), width: tw, height: th },
        { data: strategies, width: n, height: 2 },
        { data: new Int32Array(n), width: gw, height: gh },
      ]);
    }
  }
  const hfGlobal = single ? global : new JxlBitWriter();
  if (!single) sections.push(hfGlobal);
  hfGlobal.writeBool(true); // default dequant matrices
  hfGlobal.writeBits(ceilLog2(numGroups), 0); // one HF histogram preset
  hfGlobal.writeU32(0, 0x5f, 0x13, 0, { bits: 13 }); // natural coefficient orders
  hfCode.writeHeader(hfGlobal);
  for (let g = 0; g < numGroups; g++) {
    const w = single ? global : new JxlBitWriter();
    if (!single) sections.push(w);
    hfCode.writeStream(w, streams[g]!);
    if (ecPlanes.length && !single) {
      const x = (g % groupsX) * 256,
        y = Math.floor(g / groupsX) * 256;
      writeModular(
        w,
        ecPlanes.map((p) => rect(p, width, x, y, Math.min(256, width - x), Math.min(256, height - y))),
      );
    }
  }
  const payloads = sections.map((s) => s.finish());
  const out = new JxlBitWriter();
  out.writeBits(8, 0xff);
  out.writeBits(8, 0x0a);
  writeSizeHeader(out, width, height);
  writeImageMetadata(out, bitDepth, layout, image.linearColorSpace, true, undefined, intensityTarget);
  writeFrameHeader(out, layout.extraChannels.length, 1, true);
  writeToc(
    out,
    payloads.map((p) => p.length),
  );
  for (const payload of payloads) out.writeBytes(payload);
  const bytes = out.finish();
  return options.container ? wrapJxlContainer(bytes) : bytes;
}
