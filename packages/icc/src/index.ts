export { parse, readIccHeader, readIccMetadata } from './metadata.js';
export type { IccMetadata, IccMetadataValue, IccVersion, IccIntent } from './metadata.js';
export {
  readIccTagValue,
  readIccLocalizedText,
  writeIccText,
  writeIccDescription,
  writeIccLocalizedText,
  writeIccXyz,
} from './tags.js';
export type { IccTagValue, IccLocalizedText } from './tags.js';

/** ICC v2/v4 binary profile I/O. Unknown tags are retained verbatim. No platform CMS or WASM needed. */
export interface IccTag {
  signature: string;
  data: Uint8Array;
}
export interface IccProfile {
  header: Uint8Array;
  tags: IccTag[];
}
export type IccMatrix = [[number, number, number], [number, number, number], [number, number, number]];
export interface IccCurve {
  evaluate: (v: number) => number;
  inverse: (v: number) => number;
}
export interface IccRgbTransform {
  matrix: IccMatrix;
  curves: [IccCurve, IccCurve, IccCurve];
}
const signature = (b: Uint8Array, off: number) => String.fromCharCode(...b.subarray(off, off + 4));
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const fixed = (d: DataView, off: number) => d.getInt32(off) / 65536;

/** Validate bounds before interpreting the table; returned byte arrays do not alias the input. */
export function readIccProfile(bytes: Uint8Array): IccProfile {
  if (bytes.length < 132 || signature(bytes, 36) !== 'acsp') throw new Error('ICC: invalid profile header');
  const d = view(bytes),
    size = d.getUint32(0),
    count = d.getUint32(128);
  if (size < 132 || size > bytes.length || count > (size - 132) / 12) throw new Error('ICC: truncated profile');
  // ICC tags may share or overlap ranges. Own one bounded copy, not one potentially large copy per tag.
  const owned = new Uint8Array(bytes.subarray(0, size));
  const tags: IccTag[] = [];
  for (let i = 0; i < count; i++) {
    const p = 132 + 12 * i,
      off = d.getUint32(p + 4),
      len = d.getUint32(p + 8);
    if (off < 132 + count * 12 || off > size || len > size - off) throw new Error('ICC: invalid tag bounds');
    tags.push({ signature: signature(bytes, p), data: owned.subarray(off, off + len) });
  }
  return { header: owned.subarray(0, 128), tags };
}

/** Serialize a parsed or edited profile, preserving opaque tag payloads. Recomputes lengths and alignment. */
export function writeIccProfile(profile: IccProfile): Uint8Array {
  if (profile.header.length !== 128 || signature(profile.header, 36) !== 'acsp') throw new Error('ICC: invalid header');
  let size = 132 + profile.tags.length * 12;
  if (size > 0xffffffff) throw new Error('ICC: profile exceeds the 32-bit size limit');
  interface Range {
    start: number;
    end: number;
    tag: number;
  }
  interface Chunk {
    buffer: ArrayBufferLike;
    start: number;
    end: number;
    members: Range[];
    offset: number;
  }
  // Group by buffer and alignment residue, allowing overlapping ranges to share a copy while
  // keeping every serialized tag offset four-byte aligned (even when callers pass unaligned views).
  const groups = new Map<ArrayBufferLike, Range[][]>();
  profile.tags.forEach((t, tag) => {
    if (t.signature.length !== 4 || !/^[\x20-\x7e]{4}$/.test(t.signature))
      throw new Error('ICC: tag signatures must be four bytes');
    let residues = groups.get(t.data.buffer);
    if (!residues) {
      residues = [[], [], [], []];
      groups.set(t.data.buffer, residues);
    }
    residues[t.data.byteOffset % 4]!.push({ start: t.data.byteOffset, end: t.data.byteOffset + t.data.length, tag });
  });
  const chunks: Chunk[] = [];
  for (const [buffer, residues] of groups)
    for (const ranges of residues) {
      let chunk: Chunk | undefined;
      for (const range of ranges.toSorted((a, b) => a.start - b.start)) {
        if (chunk && range.start <= chunk.end) {
          chunk.end = Math.max(chunk.end, range.end);
          chunk.members.push(range);
        } else {
          chunk = { buffer, start: range.start, end: range.end, members: [range], offset: 0 };
          chunks.push(chunk);
        }
      }
    }
  const offsets: number[] = [];
  for (const chunk of chunks) {
    const aligned = Math.ceil((chunk.end - chunk.start) / 4) * 4;
    if (size > 0xffffffff - aligned) throw new Error('ICC: profile exceeds the 32-bit size limit');
    chunk.offset = size;
    size += aligned;
    for (const member of chunk.members) offsets[member.tag] = chunk.offset + member.start - chunk.start;
  }
  const out = new Uint8Array(size),
    d = view(out);
  out.set(profile.header);
  d.setUint32(0, size);
  d.setUint32(128, profile.tags.length);
  // A modified profile no longer has the old MD5 profile ID (ICC.1 section 7.2.18).
  out.fill(0, 84, 100);
  profile.tags.forEach((t, i) => {
    const p = 132 + 12 * i;
    const off = offsets[i]!;
    for (let c = 0; c < 4; c++) out[p + c] = t.signature.charCodeAt(c);
    d.setUint32(p + 4, off);
    d.setUint32(p + 8, t.data.length);
  });
  for (const chunk of chunks) out.set(new Uint8Array(chunk.buffer, chunk.start, chunk.end - chunk.start), chunk.offset);
  return out;
}

function curve(evaluate: (v: number) => number, inverse?: (v: number) => number): IccCurve {
  return {
    evaluate,
    inverse:
      inverse ??
      ((y) => {
        // Matrix/TRC display profiles use monotonic curves. Binary inversion also handles table plateaus.
        let lo = 0,
          hi = 1;
        if (y <= evaluate(0)) return 0;
        if (y >= evaluate(1)) return 1;
        for (let i = 0; i < 32; i++) {
          const mid = (lo + hi) / 2;
          if (evaluate(mid) < y) lo = mid;
          else hi = mid;
        }
        return (lo + hi) / 2;
      }),
  };
}

/** ICC curveType and parametricCurveType (functions 0–4). Returns undefined for unsupported tag types. */
export function readIccCurve(bytes: Uint8Array): IccCurve | undefined {
  if (bytes.length < 12) throw new Error('ICC: truncated curve');
  const d = view(bytes),
    type = signature(bytes, 0);
  if (type === 'curv') {
    const n = d.getUint32(8);
    if (n > (bytes.length - 12) / 2) throw new Error('ICC: truncated curve table');
    if (n === 0)
      return curve(
        (x) => x,
        (x) => x,
      );
    if (n === 1) {
      const gamma = d.getUint16(12) / 256;
      return curve(
        (x) => Math.sign(x) * Math.abs(x) ** gamma,
        (x) => Math.sign(x) * Math.abs(x) ** (1 / gamma),
      );
    }
    return curve((x) => {
      const p = Math.min(1, Math.max(0, x)) * (n - 1),
        i = Math.min(n - 2, Math.floor(p)),
        t = p - i;
      return (d.getUint16(12 + 2 * i) * (1 - t) + d.getUint16(14 + 2 * i) * t) / 65535;
    });
  }
  if (type !== 'para') return undefined;
  const fn = d.getUint16(8),
    counts = [1, 3, 4, 5, 7],
    n = counts[fn];
  if (n === undefined) return undefined;
  if (bytes.length < 12 + n * 4) throw new Error('ICC: truncated parametric curve');
  const p = Array.from({ length: n }, (_, i) => fixed(d, 12 + i * 4));
  const [g, a = 1, b = 0, c = 0, threshold = 0, e = 0, f = 0] = p;
  return curve(
    (x) => {
      if (fn === 0) return Math.sign(x) * Math.abs(x) ** g!;
      if (fn === 1) return x >= -b / a ? (a * x + b) ** g! : 0;
      if (fn === 2) return x >= -b / a ? (a * x + b) ** g! + c : c;
      if (fn === 3) return x >= threshold ? (a * x + b) ** g! : c * x;
      return x >= threshold ? (a * x + b) ** g! + e : c * x + f;
    },
    (y) => {
      if (fn === 0) return Math.sign(y) * Math.abs(y) ** (1 / g!);
      if (fn === 1) return y > 0 ? (y ** (1 / g!) - b) / a : 0;
      if (fn === 2) return y > c ? ((y - c) ** (1 / g!) - b) / a : 0;
      const offset = fn === 4 ? e : 0;
      return y >= (a * threshold + b) ** g! + offset
        ? ((y - offset) ** (1 / g!) - b) / a
        : c === 0
          ? 0
          : (y - (fn === 4 ? f : 0)) / c;
    },
  );
}

/** RGB display matrix/TRC profile to D50 XYZ PCS. LUT/CMYK/gray profiles deliberately return undefined. */
export function readIccRgbTransform(profile: IccProfile): IccRgbTransform | undefined {
  if (signature(profile.header, 16) !== 'RGB ' || signature(profile.header, 20) !== 'XYZ ') return undefined;
  if (profile.tags.some((t) => /^(A2B|B2A|D2B|B2D)/.test(t.signature))) return undefined;
  const tag = (s: string) => profile.tags.find((t) => t.signature === s)?.data;
  const xyz = ['rXYZ', 'gXYZ', 'bXYZ'].map((s) => {
    const b = tag(s);
    if (!b || b.length < 20 || signature(b, 0) !== 'XYZ ') return undefined;
    const d = view(b);
    return [fixed(d, 8), fixed(d, 12), fixed(d, 16)];
  });
  const curves = ['rTRC', 'gTRC', 'bTRC'].map((s) => {
    const b = tag(s);
    return b && readIccCurve(b);
  });
  if (xyz.some((v) => !v) || curves.some((v) => !v)) return undefined;
  // rXYZ/gXYZ/bXYZ are already adapted to the D50 PCS; applying chad again would double-adapt.
  return {
    matrix: [0, 1, 2].map((r) => xyz.map((v) => v![r]!)) as IccMatrix,
    curves: curves as IccRgbTransform['curves'],
  };
}

/** ICC v4.4 cicpType, usable even when an HDR profile uses LUT tags for legacy CMMs. */
export function readIccCicp(
  profile: IccProfile,
): { primaries: number; transfer: number; matrix: number; fullRange: boolean } | undefined {
  const t = profile.tags.find((t) => t.signature === 'cicp')?.data;
  if (!t || t.length < 12 || signature(t, 0) !== 'cicp') return undefined;
  return { primaries: t[8]!, transfer: t[9]!, matrix: t[10]!, fullRange: t[11] === 1 };
}

export { createSrgbIccProfile } from './srgb.js';

/** Read the opaque 16-byte Adobe gain-map GUID, or undefined for an absent/truncated tag.
 * Pass a profile returned by readIccProfile to validate its header and tag bounds first.
 */
export function readIccAdgcGuid(profile: IccProfile): Uint8Array | undefined {
  const tag = profile.tags.find((t) => t.signature === 'ADGC')?.data;
  return tag && tag.length >= 28 ? Uint8Array.from(tag.subarray(12, 28)) : undefined;
}

export { getIccTag, readIccHeader, removeIccTags, setIccTag, writeIccHeader, type IccHeader } from './profileData.js';
