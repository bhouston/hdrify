/**
 * JPEG XL entropy decoding (ISO/IEC 18181-1 Annex C): hybrid-uint tokens coded with either rANS
 * (12-bit precision, alias tables) or Brotli-style prefix codes, optional LZ77, and context clustering.
 * Ported from libjxl lib/jxl/dec_ans.{h,cc}, ans_common.cc, dec_huffman.cc, dec_context_map.cc,
 * lehmer_code.h, coeff_order.cc, cross-checked against jxl-oxide crates/jxl-coding.
 */
import type { JxlBitReader } from './jxlBitReader.js';

const ANS_LOG_TAB_SIZE = 12;
const ANS_TAB_SIZE = 1 << ANS_LOG_TAB_SIZE;
const ANS_FINAL_STATE = 0x130000;
const PREFIX_MAX_BITS = 15;
const WINDOW_SIZE = 1 << 20;
const WINDOW_MASK = WINDOW_SIZE - 1;
const MAX_CLUSTERS = 256;

/** ceil(log2(x + 1)): the number of bits needed to represent `x`. */
function addLog2Ceil(x: number): number {
  return x === 0 ? 0 : 32 - Math.clz32(x);
}

// ---------------------------------------------------------------------------------------------
// Hybrid integer coding (C.2.7)

export interface HybridUintConfig {
  splitExponent: number;
  /** 1 << splitExponent: tokens below this are literal values. */
  split: number;
  msbInToken: number;
  lsbInToken: number;
}

/** HybridUintConfig bundle bounded by `logAlphaSize` (libjxl DecodeUintConfig). */
export function readHybridUintConfig(br: JxlBitReader, logAlphaSize: number): HybridUintConfig {
  const splitExponent = br.readBits(addLog2Ceil(logAlphaSize));
  let msbInToken = 0;
  let lsbInToken = 0;
  if (splitExponent !== logAlphaSize) {
    msbInToken = br.readBits(addLog2Ceil(splitExponent));
    if (msbInToken > splitExponent) throw new Error('JXL: invalid hybrid uint config');
    lsbInToken = br.readBits(addLog2Ceil(splitExponent - msbInToken));
  }
  if (msbInToken + lsbInToken > splitExponent) throw new Error('JXL: invalid hybrid uint config');
  return { splitExponent, split: 2 ** splitExponent, msbInToken, lsbInToken };
}

/** Expand `token` into an integer, reading the remaining bits (libjxl ReadHybridUintConfig). */
export function readHybridUint(br: JxlBitReader, cfg: HybridUintConfig, token: number): number {
  if (token < cfg.split) return token;
  const msb = cfg.msbInToken;
  const lsb = cfg.lsbInToken;
  const n = cfg.splitExponent - msb - lsb + Math.floor((token - cfg.split) / 2 ** (msb + lsb));
  if (n > 32) throw new Error('JXL: hybrid uint too large');
  const low = token & ((1 << lsb) - 1);
  const high = ((token >>> lsb) & ((1 << msb) - 1)) | (1 << msb);
  return (high * 2 ** n + br.readBits(n)) * (1 << lsb) + low;
}

// ---------------------------------------------------------------------------------------------
// ANS histograms and alias tables (C.2.5, C.2.6)

/** DecodeVarLenUint8. */
function readVarLenUint8(br: JxlBitReader): number {
  if (!br.readBits(1)) return 0;
  const n = br.readBits(3);
  return (1 << n) + br.readBits(n);
}

/** Prefix code for histogram log-counts as [bits, logcount + 1] pairs indexed by 7 peeked bits (libjxl ReadHistogram `huff`). */
// prettier-ignore
export const LOGCOUNT_HUFF = new Uint8Array([
  3, 10, 7, 12, 3, 7, 4, 3, 3, 6, 3, 8, 3, 9, 4, 5, 3, 10, 4, 4, 3, 7, 4, 1, 3, 6, 3, 8, 3, 9, 4, 2,
  3, 10, 5, 0, 3, 7, 4, 3, 3, 6, 3, 8, 3, 9, 4, 5, 3, 10, 4, 4, 3, 7, 4, 1, 3, 6, 3, 8, 3, 9, 4, 2,
  3, 10, 6, 11, 3, 7, 4, 3, 3, 6, 3, 8, 3, 9, 4, 5, 3, 10, 4, 4, 3, 7, 4, 1, 3, 6, 3, 8, 3, 9, 4, 2,
  3, 10, 5, 0, 3, 7, 4, 3, 3, 6, 3, 8, 3, 9, 4, 5, 3, 10, 4, 4, 3, 7, 4, 1, 3, 6, 3, 8, 3, 9, 4, 2,
  3, 10, 7, 13, 3, 7, 4, 3, 3, 6, 3, 8, 3, 9, 4, 5, 3, 10, 4, 4, 3, 7, 4, 1, 3, 6, 3, 8, 3, 9, 4, 2,
  3, 10, 5, 0, 3, 7, 4, 3, 3, 6, 3, 8, 3, 9, 4, 5, 3, 10, 4, 4, 3, 7, 4, 1, 3, 6, 3, 8, 3, 9, 4, 2,
  3, 10, 6, 11, 3, 7, 4, 3, 3, 6, 3, 8, 3, 9, 4, 5, 3, 10, 4, 4, 3, 7, 4, 1, 3, 6, 3, 8, 3, 9, 4, 2,
  3, 10, 5, 0, 3, 7, 4, 3, 3, 6, 3, 8, 3, 9, 4, 5, 3, 10, 4, 4, 3, 7, 4, 1, 3, 6, 3, 8, 3, 9, 4, 2,
]);

/**
 * Read one ANS distribution (libjxl ReadHistogram with precision 12). Returns counts of length
 * `1 << logAlphaSize` summing to 4096.
 */
export function readAnsHistogram(br: JxlBitReader, logAlphaSize: number): Uint16Array {
  const tableSize = 1 << logAlphaSize;
  const counts = new Uint16Array(tableSize);
  if (br.readBits(1)) {
    // Simple: one or two symbols.
    const numSymbols = br.readBits(1) + 1;
    const s0 = readVarLenUint8(br);
    const s1 = numSymbols === 2 ? readVarLenUint8(br) : 0;
    if (Math.max(s0, s1) >= tableSize) throw new Error('JXL: ANS histogram symbol out of range');
    if (numSymbols === 1) {
      counts[s0] = ANS_TAB_SIZE;
    } else {
      if (s0 === s1) throw new Error('JXL: invalid ANS histogram');
      const c0 = br.readBits(ANS_LOG_TAB_SIZE);
      counts[s0] = c0;
      counts[s1] = ANS_TAB_SIZE - c0;
    }
    return counts;
  }
  if (br.readBits(1)) {
    // Flat.
    const alphabetSize = readVarLenUint8(br) + 1;
    if (alphabetSize > tableSize) throw new Error('JXL: ANS histogram alphabet too large');
    const base = Math.floor(ANS_TAB_SIZE / alphabetSize);
    const leftover = ANS_TAB_SIZE % alphabetSize;
    for (let i = 0; i < alphabetSize; i++) counts[i] = base + (i < leftover ? 1 : 0);
    return counts;
  }

  // Log-count coded with optional extra precision bits and RLE.
  let log = 0;
  while (log < 3 && br.readBits(1)) log++;
  const shift = (br.readBits(log) | (1 << log)) - 1;
  if (shift > ANS_LOG_TAB_SIZE + 1) throw new Error('JXL: invalid ANS histogram shift');
  const length = readVarLenUint8(br) + 3;
  if (length > tableSize) throw new Error('JXL: ANS histogram alphabet too large');

  const logcounts = new Int8Array(length);
  const same = new Uint16Array(length);
  let omitLog = -1;
  let omitPos = -1;
  for (let i = 0; i < length; i++) {
    const idx = br.peekBits(7);
    br.skipBits(LOGCOUNT_HUFF[idx * 2]!);
    const lc = LOGCOUNT_HUFF[idx * 2 + 1]! - 1;
    logcounts[i] = lc;
    if (lc === ANS_LOG_TAB_SIZE) {
      const rle = readVarLenUint8(br);
      same[i] = rle + 5;
      i += rle + 3;
      continue;
    }
    if (lc > omitLog) {
      omitLog = lc;
      omitPos = i;
    }
  }
  if (omitPos < 0) throw new Error('JXL: invalid ANS histogram');
  if (omitPos + 1 < length && logcounts[omitPos + 1] === ANS_LOG_TAB_SIZE)
    throw new Error('JXL: invalid ANS histogram');

  let total = 0;
  let prev = 0;
  let numSame = 0;
  for (let i = 0; i < length; i++) {
    if (same[i]) {
      numSame = same[i]! - 1;
      prev = i > 0 ? counts[i - 1]! : 0;
    }
    if (numSame > 0) {
      counts[i] = prev;
      numSame--;
    } else {
      const code = logcounts[i]!;
      if (i === omitPos || code < 0) continue;
      if (shift === 0 || code === 0) {
        counts[i] = 1 << code;
      } else {
        // GetPopulationCountPrecision
        const bitcount = Math.max(0, Math.min(code, shift - ((ANS_LOG_TAB_SIZE - code) >> 1)));
        counts[i] = (1 << code) + (br.readBits(bitcount) << (code - bitcount));
      }
    }
    total += counts[i]!;
    if (total > ANS_TAB_SIZE) throw new Error('JXL: invalid ANS histogram count');
  }
  if (total >= ANS_TAB_SIZE) throw new Error('JXL: invalid ANS histogram count');
  counts[omitPos] = ANS_TAB_SIZE - total;
  return counts;
}

/** Alias table (C.2.6), one entry per bucket of `4096 >> logAlphaSize` states. */
export interface AnsAliasTable {
  logBucketSize: number;
  cutoff: Uint16Array;
  rightValue: Uint16Array;
  offset1: Uint16Array;
  freq0: Uint16Array;
  freq1: Uint16Array;
}

/** Build the alias table for `counts` (libjxl InitAliasTable); must match the encoder bit-exactly. */
export function buildAnsAliasTable(counts: Uint16Array, logAlphaSize: number): AnsAliasTable {
  const tableSize = 1 << logAlphaSize;
  const logBucketSize = ANS_LOG_TAB_SIZE - logAlphaSize;
  const entrySize = 1 << logBucketSize;
  const t: AnsAliasTable = {
    logBucketSize,
    cutoff: new Uint16Array(tableSize),
    rightValue: new Uint16Array(tableSize),
    offset1: new Uint16Array(tableSize),
    freq0: new Uint16Array(tableSize),
    freq1: new Uint16Array(tableSize),
  };
  let len = tableSize;
  while (len > 0 && counts[len - 1] === 0) len--;
  const dist = len === 0 ? Uint16Array.of(ANS_TAB_SIZE) : counts.subarray(0, len);

  const single = dist.indexOf(ANS_TAB_SIZE);
  if (single >= 0) {
    // State is left unchanged by a single-symbol distribution.
    for (let i = 0; i < tableSize; i++) {
      t.rightValue[i] = single;
      t.offset1[i] = entrySize * i;
      t.freq0[i] = i < dist.length ? dist[i]! : 0;
      t.freq1[i] = ANS_TAB_SIZE;
    }
    return t;
  }

  const cutoffs = new Int32Array(tableSize);
  const underfull: number[] = [];
  const overfull: number[] = [];
  for (let i = 0; i < tableSize; i++) {
    cutoffs[i] = i < dist.length ? dist[i]! : 0;
    if (cutoffs[i]! > entrySize) overfull.push(i);
    else if (cutoffs[i]! < entrySize) underfull.push(i);
  }
  while (overfull.length > 0) {
    const o = overfull.pop()!;
    const u = underfull.pop();
    if (u === undefined) throw new Error('JXL: invalid ANS distribution');
    cutoffs[o]! -= entrySize - cutoffs[u]!;
    t.rightValue[u] = o;
    t.offset1[u] = cutoffs[o]!;
    if (cutoffs[o]! < entrySize) underfull.push(o);
    else if (cutoffs[o]! > entrySize) overfull.push(o);
  }
  for (let i = 0; i < tableSize; i++) {
    if (cutoffs[i] === entrySize) {
      t.rightValue[i] = i;
      t.offset1[i] = 0;
      t.cutoff[i] = 0;
    } else {
      t.offset1[i] = t.offset1[i]! - cutoffs[i]!;
      t.cutoff[i] = cutoffs[i]!;
    }
    const r = t.rightValue[i]!;
    t.freq0[i] = i < dist.length ? dist[i]! : 0;
    t.freq1[i] = r < dist.length ? dist[r]! : 0;
  }
  return t;
}

// ---------------------------------------------------------------------------------------------
// Prefix codes (C.2.4, Brotli RFC 7932 section 3.4/3.5)

/** Single-level lookup table indexed by the next `bits` stream bits (LSB-first). */
export interface PrefixCode {
  bits: number;
  symbols: Uint16Array;
  lengths: Uint8Array;
}

/**
 * Build a canonical prefix-code table from per-symbol code lengths. A single used symbol yields a
 * 0-bit code; otherwise the lengths must form a complete code.
 * ponytail: single-level table of 2^maxLen entries (≤ 32K); two-level tables if memory matters.
 */
export function buildPrefixCode(codeLengths: ArrayLike<number>): PrefixCode {
  let maxLen = 0;
  let used = 0;
  let last = 0;
  const blCount = new Uint32Array(PREFIX_MAX_BITS + 1);
  for (let s = 0; s < codeLengths.length; s++) {
    const l = codeLengths[s]!;
    if (l === 0) continue;
    if (l > PREFIX_MAX_BITS) throw new Error('JXL: prefix code length too long');
    used++;
    last = s;
    blCount[l]!++;
    if (l > maxLen) maxLen = l;
  }
  if (used === 0) throw new Error('JXL: empty prefix code');
  if (used === 1) return { bits: 0, symbols: Uint16Array.of(last), lengths: Uint8Array.of(0) };

  let kraft = 0;
  for (let l = 1; l <= maxLen; l++) kraft += blCount[l]! << (maxLen - l);
  if (kraft !== 1 << maxLen) throw new Error('JXL: incomplete prefix code');

  const nextCode = new Uint32Array(PREFIX_MAX_BITS + 2);
  for (let l = 1, code = 0; l <= maxLen; l++) {
    code = (code + blCount[l - 1]!) << 1;
    nextCode[l] = code;
  }

  const size = 1 << maxLen;
  const symbols = new Uint16Array(size);
  const lengths = new Uint8Array(size);
  for (let s = 0; s < codeLengths.length; s++) {
    const l = codeLengths[s]!;
    if (l === 0) continue;
    const code = nextCode[l]!++;
    let rev = 0;
    for (let b = 0; b < l; b++) rev |= ((code >> b) & 1) << (l - 1 - b);
    for (let j = rev; j < size; j += 1 << l) {
      symbols[j] = s;
      lengths[j] = l;
    }
  }
  return { bits: maxLen, symbols, lengths };
}

const CODE_LENGTH_CODE_ORDER = [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15];
/** Static code for code-length code lengths as [bits, value] by 4 peeked bits. */
const CODE_LENGTH_HUFF = [
  2, 0, 2, 4, 2, 3, 3, 2, 2, 0, 2, 4, 2, 3, 4, 1, 2, 0, 2, 4, 2, 3, 3, 2, 2, 0, 2, 4, 2, 3, 4, 5,
];

/** Read a prefix code for `alphabetSize` symbols (libjxl HuffmanDecodingData::ReadFromBitStream). */
export function readPrefixCode(br: JxlBitReader, alphabetSize: number): PrefixCode {
  if (alphabetSize === 1) return { bits: 0, symbols: Uint16Array.of(0), lengths: Uint8Array.of(0) };
  if (alphabetSize > 1 << PREFIX_MAX_BITS) throw new Error('JXL: prefix alphabet too large');
  const lengths = new Uint8Array(alphabetSize);
  const hskip = br.readBits(2);

  if (hskip === 1) {
    // Simple code (ReadSimpleCode).
    const maxBits = addLog2Ceil(alphabetSize - 1);
    let n = br.readBits(2) + 1;
    const syms: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = br.readBits(maxBits);
      if (s >= alphabetSize || syms.includes(s)) throw new Error('JXL: invalid simple prefix code');
      syms.push(s);
    }
    if (n === 1) return { bits: 0, symbols: Uint16Array.of(syms[0]!), lengths: Uint8Array.of(0) };
    if (n === 4) n += br.readBits(1);
    const lens = [[], [1, 1], [1, 2, 2], [2, 2, 2, 2], [1, 2, 3, 3]][n - 1]!;
    for (let i = 0; i < syms.length; i++) lengths[syms[i]!] = lens[i]!;
    return buildPrefixCode(lengths);
  }

  // Complex code: code-length code lengths, then code lengths with repeat codes 16/17.
  const clcl = new Uint8Array(18);
  let space = 32;
  let numCodes = 0;
  for (let i = hskip; i < 18 && space > 0; i++) {
    const p = br.peekBits(4) * 2;
    br.skipBits(CODE_LENGTH_HUFF[p]!);
    const v = CODE_LENGTH_HUFF[p + 1]!;
    clcl[CODE_LENGTH_CODE_ORDER[i]!] = v;
    if (v !== 0) {
      space -= 32 >> v;
      numCodes++;
    }
  }
  if (numCodes !== 1 && space !== 0) throw new Error('JXL: invalid prefix code-length code');
  const clc = buildPrefixCode(clcl);

  let symbol = 0;
  let prevLen = 8;
  let repeat = 0;
  let repeatLen = 0;
  space = 1 << PREFIX_MAX_BITS;
  while (symbol < alphabetSize && space > 0) {
    const idx = br.peekBits(clc.bits);
    br.skipBits(clc.lengths[idx]!);
    const len = clc.symbols[idx]!;
    if (len < 16) {
      repeat = 0;
      lengths[symbol++] = len;
      if (len !== 0) {
        prevLen = len;
        space -= (1 << PREFIX_MAX_BITS) >> len;
      }
    } else {
      const extraBits = len - 14;
      const newLen = len === 16 ? prevLen : 0;
      if (repeatLen !== newLen) {
        repeat = 0;
        repeatLen = newLen;
      }
      const oldRepeat = repeat;
      if (repeat > 0) repeat = (repeat - 2) << extraBits;
      repeat += br.readBits(extraBits) + 3;
      const delta = repeat - oldRepeat;
      if (symbol + delta > alphabetSize) throw new Error('JXL: prefix code repeat overflow');
      lengths.fill(repeatLen, symbol, symbol + delta);
      symbol += delta;
      if (repeatLen !== 0) space -= delta << (PREFIX_MAX_BITS - repeatLen);
    }
  }
  if (space !== 0) throw new Error('JXL: invalid prefix code lengths');
  return buildPrefixCode(lengths);
}

// ---------------------------------------------------------------------------------------------
// Context map (C.2.2)

/** Read the clustering of `numDists` contexts (libjxl DecodeContextMap). Values are cluster indices without holes. */
export function readContextMap(br: JxlBitReader, numDists: number): Uint8Array {
  const map = new Uint8Array(numDists);
  if (numDists === 1) return map;
  if (br.readBits(1)) {
    const bits = br.readBits(2);
    for (let i = 0; i < numDists; i++) map[i] = br.readBits(bits);
  } else {
    const useMtf = br.readBits(1) === 1;
    // LZ77 is disallowed for tiny maps to bound recursion.
    const dec = JxlEntropyDecoder.read(br, 1, numDists > 2);
    dec.begin(br);
    for (let i = 0; i < numDists; i++) {
      const v = dec.readUint(br, 0);
      if (v >= MAX_CLUSTERS) throw new Error('JXL: invalid cluster index');
      map[i] = v;
    }
    dec.finish();
    if (useMtf) {
      const mtf = new Uint8Array(256);
      for (let i = 0; i < 256; i++) mtf[i] = i;
      for (let i = 0; i < numDists; i++) {
        const idx = map[i]!;
        const v = mtf[idx]!;
        map[i] = v;
        mtf.copyWithin(1, 0, idx);
        mtf[0] = v;
      }
    }
  }
  let numClusters = 0;
  for (const c of map) if (c >= numClusters) numClusters = c + 1;
  const seen = new Uint8Array(numClusters);
  for (const c of map) seen[c] = 1;
  if (seen.includes(0)) throw new Error('JXL: context map has holes');
  return map;
}

// ---------------------------------------------------------------------------------------------
// Entropy decoder (C.2.1, C.3)

/** LZ77 special distances (dx, dy) from WebP lossless, used when distMultiplier != 0. */
// prettier-ignore
const SPECIAL_DISTANCES = new Int8Array([
  0, 1, 1, 0, 1, 1, -1, 1, 0, 2, 2, 0, 1, 2, -1, 2, 2, 1, -2, 1, 2, 2, -2, 2, 0, 3, 3, 0, 1, 3, -1, 3,
  3, 1, -3, 1, 2, 3, -2, 3, 3, 2, -3, 2, 0, 4, 4, 0, 1, 4, -1, 4, 4, 1, -4, 1, 3, 3, -3, 3, 2, 4, -2, 4,
  4, 2, -4, 2, 0, 5, 3, 4, -3, 4, 4, 3, -4, 3, 5, 0, 1, 5, -1, 5, 5, 1, -5, 1, 2, 5, -2, 5, 5, 2, -5, 2,
  4, 4, -4, 4, 3, 5, -3, 5, 5, 3, -5, 3, 0, 6, 6, 0, 1, 6, -1, 6, 6, 1, -6, 1, 2, 6, -2, 6, 6, 2, -6, 2,
  4, 5, -4, 5, 5, 4, -5, 4, 3, 6, -3, 6, 6, 3, -6, 3, 0, 7, 7, 0, 1, 7, -1, 7, 5, 5, -5, 5, 7, 1, -7, 1,
  4, 6, -4, 6, 6, 4, -6, 4, 2, 7, -2, 7, 7, 2, -7, 2, 3, 7, -3, 7, 7, 3, -7, 3, 5, 6, -5, 6, 6, 5, -6, 5,
  8, 0, 4, 7, -4, 7, 7, 4, -7, 4, 8, 1, 8, 2, 6, 6, -6, 6, 8, 3, 5, 7, -5, 7, 7, 5, -7, 5, 8, 4, 6, 7,
  -6, 7, 7, 6, -7, 6, 8, 5, 7, 7, -7, 7, 8, 6, 8, 7,
]);

interface Lz77Params {
  minSymbol: number;
  minLength: number;
  lengthConfig: HybridUintConfig;
}

interface EntropyCode {
  /** Context index -> cluster index; includes the LZ77 distance context last when LZ77 is enabled. */
  clusters: Uint8Array;
  configs: HybridUintConfig[];
  prefix: PrefixCode[] | null;
  ans: AnsAliasTable[] | null;
  lz77: Lz77Params | null;
}

export class JxlEntropyDecoder {
  private readonly code: EntropyCode;
  private state = 0;
  private started = false;
  private window: Float64Array | null = null;
  private numToCopy = 0;
  private copyPos = 0;
  private numDecoded = 0;

  private constructor(code: EntropyCode) {
    this.code = code;
    if (code.lz77) this.window = new Float64Array(1024);
  }

  /**
   * Read an entropy-coded stream header for `numDists` pre-clustering contexts: LZ77 params, context
   * map, use_prefix_code, log_alpha_size, hybrid-uint configs and histograms (libjxl DecodeHistograms).
   */
  static read(br: JxlBitReader, numDists: number, allowLz77 = true): JxlEntropyDecoder {
    let lz77: Lz77Params | null = null;
    if (br.readBool()) {
      if (!allowLz77) throw new Error('JXL: LZ77 not allowed here');
      const minSymbol = br.readU32(224, 512, 4096, { bits: 15, offset: 8 });
      const minLength = br.readU32(3, 4, { bits: 2, offset: 5 }, { bits: 8, offset: 9 });
      lz77 = { minSymbol, minLength, lengthConfig: readHybridUintConfig(br, 8) };
      numDists++;
    }
    const clusters = readContextMap(br, numDists);
    let numClusters = 0;
    for (const c of clusters) if (c >= numClusters) numClusters = c + 1;

    const usePrefix = br.readBool();
    const logAlphaSize = usePrefix ? PREFIX_MAX_BITS : 5 + br.readBits(2);
    const configs: HybridUintConfig[] = [];
    for (let i = 0; i < numClusters; i++) configs.push(readHybridUintConfig(br, logAlphaSize));

    let prefix: PrefixCode[] | null = null;
    let ans: AnsAliasTable[] | null = null;
    if (usePrefix) {
      const sizes: number[] = [];
      for (let i = 0; i < numClusters; i++) {
        // DecodeVarLenUint16 + 1
        let size = 1;
        if (br.readBool()) {
          const n = br.readBits(4);
          size += (1 << n) + br.readBits(n);
        }
        if (size > 1 << PREFIX_MAX_BITS) throw new Error('JXL: prefix alphabet too large');
        sizes.push(size);
      }
      prefix = sizes.map((size) => readPrefixCode(br, size));
    } else {
      ans = [];
      for (let i = 0; i < numClusters; i++)
        ans.push(buildAnsAliasTable(readAnsHistogram(br, logAlphaSize), logAlphaSize));
    }
    return new JxlEntropyDecoder({ clusters, configs, prefix, ans, lz77 });
  }

  /** A decoder sharing these histograms with fresh stream state (ANS state, LZ77 window), e.g. one per group. */
  clone(): JxlEntropyDecoder {
    return new JxlEntropyDecoder(this.code);
  }

  /** Context -> cluster map (length numDists, plus the LZ77 distance context when enabled). */
  get clusterMap(): Uint8Array {
    return this.code.clusters;
  }

  /**
   * Explicitly read the initial 32-bit ANS state (no-op for prefix codes or if already started).
   * readUint does this lazily; call it when a stream may decode zero symbols but must still consume the state.
   */
  begin(br: JxlBitReader): void {
    if (this.started) return;
    this.started = true;
    if (this.code.ans) this.state = br.readBits(32);
  }

  private readSymbol(br: JxlBitReader, cluster: number): number {
    const prefix = this.code.prefix;
    if (prefix) {
      const p = prefix[cluster]!;
      const idx = br.peekBits(p.bits);
      br.skipBits(p.lengths[idx]!);
      return p.symbols[idx]!;
    }
    if (!this.started) this.begin(br);
    const t = this.code.ans![cluster]!;
    const state = this.state;
    const res = state & (ANS_TAB_SIZE - 1);
    const i = res >>> t.logBucketSize;
    const pos = res & ((1 << t.logBucketSize) - 1);
    let symbol: number;
    let freq: number;
    let offset: number;
    if (pos >= t.cutoff[i]!) {
      symbol = t.rightValue[i]!;
      freq = t.freq1[i]!;
      offset = t.offset1[i]! + pos;
    } else {
      symbol = i;
      freq = t.freq0[i]!;
      offset = pos;
    }
    let next = freq * (state >>> ANS_LOG_TAB_SIZE) + offset;
    if (next < 0x10000) next = next * 0x10000 + br.readBits(16);
    this.state = next;
    return symbol;
  }

  /**
   * DecodeHybridVarLenUint for context `ctx`, including LZ77 back-references. `distMultiplier` is the
   * Modular channel width (0 elsewhere) used for LZ77 special distances.
   */
  readUint(br: JxlBitReader, ctx: number, distMultiplier = 0): number {
    const code = this.code;
    const lz77 = code.lz77;
    if (lz77) {
      if (this.numToCopy > 0) {
        const v = this.window![this.copyPos++ & WINDOW_MASK] ?? 0;
        this.numToCopy--;
        this.pushWindow(v);
        return v;
      }
      const cluster = code.clusters[ctx]!;
      const token = this.readSymbol(br, cluster);
      if (token >= lz77.minSymbol) {
        this.numToCopy = readHybridUint(br, lz77.lengthConfig, token - lz77.minSymbol) + lz77.minLength;
        const distCluster = code.clusters[code.clusters.length - 1]!;
        const dToken = this.readSymbol(br, distCluster);
        let distance = readHybridUint(br, code.configs[distCluster]!, dToken);
        if (distMultiplier === 0) {
          distance += 1;
        } else if (distance < 120) {
          distance = Math.max(
            1,
            SPECIAL_DISTANCES[distance * 2]! + distMultiplier * SPECIAL_DISTANCES[distance * 2 + 1]!,
          );
        } else {
          distance -= 119;
        }
        // Distances beyond the decoded prefix copy zeros (libjxl zero-fills the window).
        distance = Math.min(distance, this.numDecoded, WINDOW_SIZE);
        this.copyPos = this.numDecoded - distance;
        return this.readUint(br, ctx, distMultiplier);
      }
      const v = readHybridUint(br, code.configs[cluster]!, token);
      this.pushWindow(v);
      return v;
    }
    const cluster = code.clusters[ctx]!;
    return readHybridUint(br, code.configs[cluster]!, this.readSymbol(br, cluster));
  }

  private pushWindow(v: number): void {
    let w = this.window!;
    const i = this.numDecoded++ & WINDOW_MASK;
    if (i >= w.length) {
      const grown = new Float64Array(Math.min(WINDOW_SIZE, w.length * 2));
      grown.set(w);
      this.window = w = grown;
    }
    w[i] = v;
  }

  /** Verify the ANS final state equals 0x130000 (no-op for prefix codes); throw on mismatch. */
  finish(): void {
    if (this.code.ans && this.started && this.state !== ANS_FINAL_STATE)
      throw new Error('JXL: invalid ANS final state');
  }
}

// ---------------------------------------------------------------------------------------------
// Permutations (C.3.3 / libjxl ReadPermutation, DecodeLehmerCode)

/** GetContext(x) = min(7, ceil(log2(x + 1))). */
function permutationContext(x: number): number {
  return Math.min(7, addLog2Ceil(x));
}

/**
 * Read a Lehmer-coded permutation of `size` elements, skipping the first `skip`. Uses `dec` with
 * GetContext(x) = min(7, ceil(log2(x + 1))). Returns the permutation array.
 */
export function readPermutation(br: JxlBitReader, dec: JxlEntropyDecoder, size: number, skip: number): number[] {
  const end = dec.readUint(br, permutationContext(size)) + skip;
  if (end > size) throw new Error('JXL: invalid permutation size');
  const lehmer = new Uint32Array(size);
  let last = 0;
  for (let i = skip; i < end; i++) {
    const v = dec.readUint(br, permutationContext(last));
    if (v >= size - i) throw new Error('JXL: invalid Lehmer code');
    lehmer[i] = v;
    last = v;
  }
  const perm = Array.from({ length: size }, () => 0);
  if (size === 0) return perm;
  // Order-statistics over an implicit Fenwick tree of unused elements.
  const log2n = addLog2Ceil(size - 1);
  const paddedN = 1 << log2n;
  const temp = new Uint32Array(paddedN);
  for (let i = 0; i < paddedN; i++) temp[i] = (i + 1) & -(i + 1);
  for (let i = 0; i < size; i++) {
    let rank = lehmer[i]! + 1;
    let bit = paddedN;
    let next = 0;
    for (let b = 0; b <= log2n; b++) {
      const cand = next + bit;
      bit >>= 1;
      if (cand <= paddedN && temp[cand - 1]! < rank) {
        next = cand;
        rank -= temp[cand - 1]!;
      }
    }
    perm[i] = next;
    for (let n = next + 1; n <= paddedN; n += n & -n) temp[n - 1]!--;
  }
  return perm;
}
