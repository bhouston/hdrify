export { parse, readIccHeaderMetadata, readIccMetadata } from './metadata.js';
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
const signature = (b: Uint8Array, off: number) => String.fromCharCode(...b.subarray(off, off + 4));
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/**
 * Read ICC v2/v4 profile data, validating the header and tag bounds.
 * Tag payloads are retained opaquely, including LUT, CMYK, gray, multichannel,
 * and unknown/private tags. Parsing a profile does not evaluate curves or transform pixels.
 * Returned byte arrays do not alias the input.
 *
 * @param bytes - Complete raw ICC profile bytes, without JPEG APP2 framing.
 * @returns Header bytes and ordered tag payloads for inspection or editing.
 * @throws If the header, declared size, or tag bounds are invalid.
 */
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

/**
 * Serialize a parsed or edited profile, preserving tag order and opaque payloads.
 * Rebuilds offsets, lengths, and four-byte alignment. Clears the stale profile ID
 * without computing a replacement MD5 ID. Padding, layout, and whole-file byte
 * identity are not preserved; keep the original bytes for byte-exact transport.
 *
 * @param profile - Raw header and ordered tag payloads, typically from {@link readIccProfile}.
 * @returns Complete ICC profile bytes with rebuilt layout.
 */
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
