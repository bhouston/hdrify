/**
 * Test-only JPEG XL entropy encoder: writes streams that {@link JxlEntropyDecoder} reads, with prefix or
 * ANS codes, any context map encoding, LZ77 copies and RLE'd ANS histograms. Mirrors libjxl enc_ans.cc
 * (ANS reverse-order encoding) and Brotli's code-length repetition writer.
 */
import type { JxlBitWriter } from './jxlBitWriter.js';
import { buildCodeLengths, canonicalCodes } from './jxlEncEntropy.js';
import { buildAnsAliasTable, type HybridUintConfig, LOGCOUNT_HUFF } from './jxlEntropy.js';

const bitsFor = (x: number): number => (x === 0 ? 0 : 32 - Math.clz32(x));

export function hybridConfig(splitExponent: number, msbInToken: number, lsbInToken: number): HybridUintConfig {
  return { splitExponent, split: 2 ** splitExponent, msbInToken, lsbInToken };
}

/** HybridUintConfig::Encode: value -> token plus `nbits` raw bits. Exact for values < 2^53. */
export function encodeHybridUint(cfg: HybridUintConfig, value: number): { token: number; nbits: number; bits: number } {
  if (value < cfg.split) return { token: value, nbits: 0, bits: 0 };
  const { splitExponent: se, msbInToken: msb, lsbInToken: lsb } = cfg;
  const n = Math.floor(Math.log2(value));
  const fixedN = value >= 2 ** (n + 1) ? n + 1 : value < 2 ** n ? n - 1 : n;
  const m = value - 2 ** fixedN;
  const token =
    cfg.split + (fixedN - se) * 2 ** (msb + lsb) + Math.floor(m / 2 ** (fixedN - msb)) * 2 ** lsb + (m % 2 ** lsb);
  const nbits = fixedN - msb - lsb;
  const bits = Math.floor(value / 2 ** lsb) % 2 ** nbits;
  return { token, nbits, bits };
}

export function writeHybridUintConfig(w: JxlBitWriter, cfg: HybridUintConfig, logAlphaSize: number): void {
  w.writeBits(bitsFor(logAlphaSize), cfg.splitExponent);
  if (cfg.splitExponent === logAlphaSize) return;
  w.writeBits(bitsFor(cfg.splitExponent), cfg.msbInToken);
  w.writeBits(bitsFor(cfg.splitExponent - cfg.msbInToken), cfg.lsbInToken);
}

export function writeVarLenUint8(w: JxlBitWriter, v: number): void {
  if (v === 0) {
    w.writeBits(1, 0);
    return;
  }
  const n = 31 - Math.clz32(v);
  w.writeBits(1, 1);
  w.writeBits(3, n);
  w.writeBits(n, v - (1 << n));
}

// ---------------------------------------------------------------------------------------------
// Prefix codes

const CODE_LENGTH_ORDER = [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15];
/** Static code for code-length code lengths 0..5 as [nbits, bits]. */
const CL_STATIC: [number, number][] = [
  [2, 0],
  [4, 7],
  [3, 3],
  [2, 2],
  [2, 1],
  [4, 15],
];

/** Brotli WriteHuffmanTreeRepetitions(Zeros): code-length symbols with repeat codes 16/17. */
function codeLengthSymbols(lengths: Uint8Array, useRepeats: boolean): { sym: number; extra: number }[] {
  let last = lengths.length - 1;
  while (last >= 0 && lengths[last] === 0) last--;
  const out: { sym: number; extra: number }[] = [];
  let prev = 8;
  for (let i = 0; i <= last;) {
    const v = lengths[i]!;
    let reps = 1;
    while (i + reps <= last && lengths[i + reps] === v) reps++;
    i += reps;
    if (!useRepeats) {
      for (let k = 0; k < reps; k++) out.push({ sym: v, extra: 0 });
      if (v !== 0) prev = v;
      continue;
    }
    if (v === 0) {
      if (reps === 11) {
        out.push({ sym: 0, extra: 0 });
        reps--;
      }
      if (reps < 3) {
        for (let k = 0; k < reps; k++) out.push({ sym: 0, extra: 0 });
      } else {
        const start = out.length;
        reps -= 3;
        for (;;) {
          out.push({ sym: 17, extra: reps & 7 });
          if (reps < 8) break;
          reps = (reps >> 3) - 1;
        }
        out.push(...out.splice(start).toReversed());
      }
    } else {
      if (prev !== v) {
        out.push({ sym: v, extra: 0 });
        reps--;
      }
      if (reps === 7) {
        out.push({ sym: v, extra: 0 });
        reps--;
      }
      if (reps < 3) {
        for (let k = 0; k < reps; k++) out.push({ sym: v, extra: 0 });
      } else {
        const start = out.length;
        reps -= 3;
        for (;;) {
          out.push({ sym: 16, extra: reps & 3 });
          if (reps < 4) break;
          reps = (reps >> 2) - 1;
        }
        out.push(...out.splice(start).toReversed());
      }
      prev = v;
    }
  }
  return out;
}

export interface EncPrefixCode {
  lengths: Uint8Array;
  codes: Uint16Array;
}

/**
 * Write a prefix code for `freqs` (alphabet = freqs.length) and return it for symbol writing.
 * `simple` uses the NSYM 1–4 form when ≤ 4 symbols are used (tree-select when lengths differ).
 */
export function writePrefixCode(
  w: JxlBitWriter,
  freqs: ArrayLike<number>,
  opts: { simple?: boolean; repeats?: boolean } = {},
): EncPrefixCode {
  const alphabetSize = freqs.length;
  const used: number[] = [];
  for (let s = 0; s < alphabetSize; s++) if (freqs[s]! > 0) used.push(s);
  if (used.length === 0) used.push(0);
  const zero = { lengths: new Uint8Array(alphabetSize), codes: new Uint16Array(alphabetSize) };
  if (alphabetSize === 1) return zero;
  const symBits = bitsFor(alphabetSize - 1);
  if (used.length === 1) {
    w.writeBits(2, 1);
    w.writeBits(2, 0);
    w.writeBits(symBits, used[0]!);
    return zero;
  }
  let lengths = buildCodeLengths(freqs, 15);
  if (opts.simple && used.length <= 4) {
    w.writeBits(2, 1);
    w.writeBits(2, used.length - 1);
    // Order by decreasing frequency so tree-select [1,2,3,3] gets the most frequent symbol first.
    const order = used.toSorted((a, b) => freqs[b]! - freqs[a]!);
    lengths = new Uint8Array(alphabetSize);
    const treeSelect = used.length === 4 && freqs[order[0]!]! > freqs[order[3]!]! * 2;
    const lens = used.length === 2 ? [1, 1] : used.length === 3 ? [1, 2, 2] : treeSelect ? [1, 2, 3, 3] : [2, 2, 2, 2];
    for (let i = 0; i < order.length; i++) {
      w.writeBits(symBits, order[i]!);
      lengths[order[i]!] = lens[i]!;
    }
    if (used.length === 4) w.writeBits(1, treeSelect ? 1 : 0);
    return { lengths, codes: canonicalCodes(lengths) };
  }

  const syms = codeLengthSymbols(lengths, opts.repeats ?? true);
  const clFreq = new Uint32Array(18);
  for (const s of syms) clFreq[s.sym]!++;
  const clLengths = buildCodeLengths(clFreq, 5);
  const clSingle = clLengths.filter((l) => l > 0).length === 1;
  const clCodes = canonicalCodes(clLengths);
  w.writeBits(2, 0); // HSKIP 0
  let count = 18;
  if (!clSingle) while (clLengths[CODE_LENGTH_ORDER[count - 1]!] === 0) count--;
  for (let i = 0; i < count; i++) {
    const [nb, b] = CL_STATIC[clLengths[CODE_LENGTH_ORDER[i]!]!]!;
    w.writeBits(nb, b);
  }
  for (const s of syms) {
    if (!clSingle) w.writeBits(clLengths[s.sym]!, clCodes[s.sym]!);
    if (s.sym === 16) w.writeBits(2, s.extra);
    if (s.sym === 17) w.writeBits(3, s.extra);
  }
  return { lengths, codes: canonicalCodes(lengths) };
}

// ---------------------------------------------------------------------------------------------
// ANS

/** Normalize frequencies to counts summing to 4096 with every used symbol ≥ 1. */
export function normalizeCounts(freqs: ArrayLike<number>, tableSize: number): Uint16Array {
  const counts = new Uint16Array(tableSize);
  let total = 0;
  for (let i = 0; i < freqs.length; i++) total += freqs[i]!;
  if (total === 0) {
    counts[0] = 4096;
    return counts;
  }
  let sum = 0;
  let maxI = 0;
  for (let i = 0; i < freqs.length; i++) {
    if (!freqs[i]) continue;
    counts[i] = Math.max(1, Math.floor((freqs[i]! * 4096) / total));
    sum += counts[i]!;
    if (counts[i]! > counts[maxI]!) maxI = i;
  }
  counts[maxI] = counts[maxI]! + 4096 - sum;
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

/** Write an ANS histogram that decodes to exactly `counts`. `mode` 'auto' picks simple forms for 1–2 symbols. */
export function writeAnsHistogram(
  w: JxlBitWriter,
  counts: Uint16Array,
  opts: { mode?: 'auto' | 'compressed'; rle?: boolean } = {},
): void {
  const used: number[] = [];
  for (let i = 0; i < counts.length; i++) if (counts[i]) used.push(i);
  if (used.length === 1 || ((opts.mode ?? 'auto') === 'auto' && used.length === 2)) {
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
    if (opts.rle && i > 0 && i - 1 !== omit) {
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
export function ansReverseMap(counts: Uint16Array, logAlphaSize: number): number[][] {
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

// ---------------------------------------------------------------------------------------------
// Whole streams

export type EntropyOp =
  | { ctx: number; value: number }
  /** LZ77 copy of `length` values; `distance` is the raw distance symbol (before special-distance mapping). */
  | { ctx: number; copy: number; distance: number };

export interface EntropyStreamSpec {
  numDists: number;
  /** Clusters for numDists contexts (+1 trailing entry for the LZ77 distance context). Default: identity. */
  contextMap?: number[];
  contextMapMode?: 'simple' | 'prefix' | 'ans' | 'prefix-mtf' | 'ans-mtf';
  lz77?: { minSymbol: number; minLength: number; lengthConfig: HybridUintConfig };
  usePrefix: boolean;
  /** ANS only, 5..8. */
  logAlphaSize?: number;
  /** One per cluster. Default: (4, 2, 0) for ANS... and prefix. */
  configs?: HybridUintConfig[];
  simplePrefix?: boolean;
  prefixRepeats?: boolean;
  ansMode?: 'auto' | 'compressed';
  ansRle?: boolean;
  /** Corrupt the final ANS state for negative tests. */
  badFinalState?: boolean;
}

interface Item {
  cluster: number;
  token: number;
  nbits: number;
  bits: number;
}

function moveToFront(values: number[]): number[] {
  const mtf = Array.from({ length: 256 }, (_, i) => i);
  return values.map((v) => {
    const idx = mtf.indexOf(v);
    mtf.splice(idx, 1);
    mtf.unshift(v);
    return idx;
  });
}

function writeContextMap(w: JxlBitWriter, map: number[], mode: EntropyStreamSpec['contextMapMode']): void {
  if (map.length === 1) return;
  const maxV = Math.max(...map);
  const m = mode ?? (bitsFor(maxV) <= 3 ? 'simple' : 'prefix');
  if (m === 'simple') {
    const bits = bitsFor(maxV);
    w.writeBits(1, 1);
    w.writeBits(2, bits);
    for (const v of map) w.writeBits(bits, v);
    return;
  }
  w.writeBits(1, 0);
  const mtf = m.endsWith('-mtf');
  w.writeBits(1, mtf ? 1 : 0);
  const values = mtf ? moveToFront(map) : map;
  writeEntropyStream(
    w,
    { numDists: 1, usePrefix: m.startsWith('prefix'), logAlphaSize: 8, configs: [hybridConfig(4, 1, 0)] },
    values.map((value) => ({ ctx: 0, value })),
  );
}

/** Write a full entropy-coded stream (header + symbols) for `ops`. */
export function writeEntropyStream(w: JxlBitWriter, spec: EntropyStreamSpec, ops: EntropyOp[]): void {
  const numCtx = spec.numDists + (spec.lz77 ? 1 : 0);
  const map = spec.contextMap ?? Array.from({ length: numCtx }, (_, i) => i);
  if (map.length !== numCtx) throw new Error('context map length mismatch');
  const numClusters = Math.max(...map) + 1;
  const logAlpha = spec.usePrefix ? 15 : (spec.logAlphaSize ?? 8);
  const configs = spec.configs ?? Array.from({ length: numClusters }, () => hybridConfig(4, 2, 0));

  // Tokenize.
  const items: Item[] = [];
  for (const op of ops) {
    const cluster = map[op.ctx]!;
    if ('copy' in op) {
      const lz = spec.lz77!;
      const len = encodeHybridUint(lz.lengthConfig, op.copy - lz.minLength);
      items.push({ cluster, token: lz.minSymbol + len.token, nbits: len.nbits, bits: len.bits });
      const dc = map[numCtx - 1]!;
      items.push({ cluster: dc, ...encodeHybridUint(configs[dc]!, op.distance) });
    } else {
      const e = encodeHybridUint(configs[cluster]!, op.value);
      if (spec.lz77 && e.token >= spec.lz77.minSymbol) throw new Error('literal token collides with LZ77');
      items.push({ cluster, ...e });
    }
  }
  const freqs: number[][] = Array.from({ length: numClusters }, () => []);
  for (const it of items) {
    const f = freqs[it.cluster]!;
    while (f.length <= it.token) f.push(0);
    f[it.token]!++;
  }

  // Header.
  w.writeBool(!!spec.lz77);
  if (spec.lz77) {
    w.writeU32(spec.lz77.minSymbol, 224, 512, 4096, { bits: 15, offset: 8 });
    w.writeU32(spec.lz77.minLength, 3, 4, { bits: 2, offset: 5 }, { bits: 8, offset: 9 });
    writeHybridUintConfig(w, spec.lz77.lengthConfig, 8);
  }
  writeContextMap(w, map, spec.contextMapMode);
  w.writeBool(spec.usePrefix);
  if (!spec.usePrefix) w.writeBits(2, logAlpha - 5);
  for (const c of configs) writeHybridUintConfig(w, c, logAlpha);

  if (spec.usePrefix) {
    for (const f of freqs) {
      const size = Math.max(1, f.length);
      if (size === 1) w.writeBool(false);
      else {
        const n = 31 - Math.clz32(size - 1);
        w.writeBool(true);
        w.writeBits(4, n);
        w.writeBits(n, size - 1 - (1 << n));
      }
    }
    const codes = freqs.map((f) =>
      writePrefixCode(w, f.length ? f : [1], { simple: spec.simplePrefix, repeats: spec.prefixRepeats }),
    );
    for (const it of items) {
      const c = codes[it.cluster]!;
      w.writeBits(c.lengths[it.token]!, c.codes[it.token]!);
      w.writeBits(it.nbits, it.bits);
    }
    return;
  }

  const tableSize = 1 << logAlpha;
  const counts = freqs.map((f) => normalizeCounts(f, tableSize));
  for (const c of counts) writeAnsHistogram(w, c, { mode: spec.ansMode, rle: spec.ansRle });
  const revs = counts.map((c) => ansReverseMap(c, logAlpha));

  // Encode in reverse (libjxl ANSCoder::PutSymbol), then emit forward.
  let state = 0x130000;
  const chunks: (number | undefined)[] = [];
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k]!;
    const freq = counts[it.cluster]![it.token]!;
    if (state >>> 20 >= freq) {
      chunks[k] = state & 0xffff;
      state >>>= 16;
    }
    state = Math.floor(state / freq) * 4096 + revs[it.cluster]![it.token]![state % freq]!;
  }
  w.writeBits(32, spec.badFinalState ? state ^ 1 : state);
  for (let k = 0; k < items.length; k++) {
    if (chunks[k] !== undefined) w.writeBits(16, chunks[k]!);
    w.writeBits(items[k]!.nbits, items[k]!.bits);
  }
}
