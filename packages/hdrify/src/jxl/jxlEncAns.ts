/** Alias-ANS writer (12-bit histograms), ported from libjxl enc_ans.cc.
 * The inverse alias table ensures exactly the decoder's symbol-slot mapping.
 */
import type { TokenStream } from './jxlEncEntropy.js';
import type { JxlBitWriter } from './jxlBitWriter.js';
import { buildAnsAliasTable, LOGCOUNT_HUFF } from './jxlEntropy.js';

function writeVarLenUint8(w: JxlBitWriter, value: number): void {
  if (!value) {
    w.writeBool(false);
    return;
  }
  const n = 31 - Math.clz32(value);
  w.writeBool(true);
  w.writeBits(3, n);
  w.writeBits(n, value - (1 << n));
}

/** Normalize frequencies to counts summing to 4096 with every used symbol ≥ 1. */
export function normalizeCounts(freqs: ArrayLike<number>): Uint16Array {
  const tableSize = 256;
  if (freqs.length > tableSize) throw new Error('JXL: ANS alphabet exceeds 256 symbols');
  const counts = new Uint16Array(tableSize);
  let total = 0;
  for (let i = 0; i < freqs.length; i++) total += freqs[i]!;
  if (total === 0) {
    counts[0] = 4096;
    return counts;
  }
  let sum = 0;
  for (let i = 0; i < freqs.length; i++) {
    if (!freqs[i]) continue;
    counts[i] = Math.max(1, Math.floor((freqs[i]! * 4096) / total));
    sum += counts[i]!;
  }
  // Removing all rounding excess from one symbol can underflow on alphabets
  // with many rare symbols. Spread the correction across the largest counts.
  while (sum > 4096) {
    let largest = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i]! > counts[largest]!) largest = i;
    counts[largest]!--;
    sum--;
  }
  while (sum < 4096) {
    let best = 0,
      deficit = -Infinity;
    for (let i = 0; i < freqs.length; i++) {
      if (!freqs[i]) continue;
      const d = (freqs[i]! * 4096) / total - counts[i]!;
      if (d > deficit) {
        deficit = d;
        best = i;
      }
    }
    counts[best]!++;
    sum++;
  }
  return counts;
}

/** floor(log2(c)), or -1 for a zero count. */
const logCount = (c: number): number => (c === 0 ? -1 : 31 - Math.clz32(c));

function writeLogCount(w: JxlBitWriter, lcPlus1: number): void {
  for (let idx = 0; idx < 128; idx++) {
    if (LOGCOUNT_HUFF[idx * 2 + 1] === lcPlus1) {
      const nb = LOGCOUNT_HUFF[idx * 2]!;
      w.writeBits(nb, idx & ((1 << nb) - 1));
      return;
    }
  }
  throw new Error('unreachable');
}

/** Write an ANS histogram that decodes to exactly `counts`, using simple forms for 1–2 symbols. */
function writeAnsHistogram(w: JxlBitWriter, counts: Uint16Array): void {
  const used: number[] = [];
  for (let i = 0; i < counts.length; i++) if (counts[i]) used.push(i);
  if (used.length <= 2) {
    // A lone count of 4096 has log-count 12, which collides with the RLE code: always simple.
    w.writeBits(1, 1);
    w.writeBits(1, used.length - 1);
    for (const s of used) writeVarLenUint8(w, s);
    if (used.length === 2) w.writeBits(12, counts[used[0]!]!);
    return;
  }
  w.writeBits(2, 0); // not simple, not flat
  // shift = 13 makes every count exactly representable: log = 3, then 3 bits of 6.
  w.writeBits(3, 0b111);
  w.writeBits(3, 6);
  const length = Math.max(3, used[used.length - 1]! + 1);
  writeVarLenUint8(w, length - 3);
  let omit = 0;
  for (let i = 0; i < length; i++) if (logCount(counts[i]!) > logCount(counts[omit]!)) omit = i;
  const explicit: number[] = [];
  for (let i = 0; i < length;) {
    if (i > 0 && i - 1 !== omit) {
      let run = 0;
      while (i + run < length && run < 259 && counts[i + run] === counts[i - 1]) run++;
      if (run >= 4) {
        writeLogCount(w, 13);
        writeVarLenUint8(w, run - 4);
        i += run;
        continue;
      }
    }
    writeLogCount(w, logCount(counts[i]!) + 1);
    explicit.push(i);
    i++;
  }
  for (const i of explicit) {
    const c = counts[i]!;
    const l = logCount(c);
    if (i === omit || l <= 0) continue;
    w.writeBits(l, c - (1 << l));
  }
}

/** reverse[sym][offset] = state slot, derived from the decoder's alias table (libjxl ANSEncSymbolInfo). */
function ansReverseMap(counts: Uint16Array, logAlphaSize: number): number[][] {
  const t = buildAnsAliasTable(counts, logAlphaSize);
  const rev: number[][] = Array.from({ length: counts.length }, () => []);
  for (let slot = 0; slot < 4096; slot++) {
    const i = slot >> t.logBucketSize;
    const pos = slot & ((1 << t.logBucketSize) - 1);
    if (pos >= t.cutoff[i]!) rev[t.rightValue[i]!]![t.offset1[i]! + pos] = slot;
    else rev[i]![pos] = slot;
  }
  return rev;
}

/** ANS model for hybrid uint (4, 1, 0) data, with optional LZ77 token offsets. */
export class JxlAnsCode {
  private readonly cache = new Map<TokenStream, { state: number; chunks: Int32Array; bits: number }>();
  private readonly counts: Uint16Array[];
  private readonly reverse: number[][][];

  constructor(histograms: ArrayLike<number>[]) {
    this.counts = histograms.map((h) => normalizeCounts(h));
    this.reverse = this.counts.map((counts) => ansReverseMap(counts, 8));
  }

  writeHistograms(w: JxlBitWriter): void {
    for (const counts of this.counts) writeAnsHistogram(w, counts);
  }

  private prepare(
    stream: TokenStream,
    offsets?: ArrayLike<number>,
  ): { state: number; chunks: Int32Array; bits: number } {
    const cached = this.cache.get(stream);
    if (cached) return cached;
    const { contexts, values } = stream;
    let bits = 32;
    const chunks = new Int32Array(values.length).fill(-1);
    let state = 0x130000;
    for (let i = values.length - 1; i >= 0; i--) {
      const value = values[i]!;
      const n = 31 - Math.clz32(value);
      const token = (value < 16 ? value : 16 + ((n - 4) << 1) + ((value >>> (n - 1)) & 1)) + (offsets?.[i] ?? 0);
      const ctx = contexts[i]!;
      const count = this.counts[ctx]![token]!;
      if (!count) throw new Error('JXL: ANS symbol absent from model');
      if (state >>> 20 >= count) {
        chunks[i] = state & 0xffff;
        bits += 16;
        state >>>= 16;
      }
      state = Math.floor(state / count) * 4096 + this.reverse[ctx]![token]![state % count]!;
      if (value >= 16) bits += 30 - Math.clz32(value);
    }
    const result = { state, chunks, bits };
    this.cache.set(stream, result);
    return result;
  }

  streamSizeBits(stream: TokenStream, offsets?: ArrayLike<number>): number {
    return this.prepare(stream, offsets).bits;
  }

  writeStream(w: JxlBitWriter, stream: TokenStream, offsets?: ArrayLike<number>): void {
    const { state, chunks } = this.prepare(stream, offsets);
    const { values } = stream;
    w.writeBits(32, state);
    for (let i = 0; i < values.length; i++) {
      if (chunks[i]! >= 0) w.writeBits(16, chunks[i]!);
      const value = values[i]!;
      if (value >= 16) {
        const nbits = 30 - Math.clz32(value);
        w.writeBits(nbits, (value & ((1 << nbits) - 1)) >>> 0);
      }
    }
  }
}
