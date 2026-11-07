import { JxlAnsCode } from './jxlEncAns.js';
import { JxlBitWriter } from './jxlBitWriter.js';

/**
 * Prefix/alias-ANS entropy coder for JPEG XL, the encoder side of the
 * spec's "entropy-coded stream": optional LZ77 and size-gated alias-ANS,
 * one histogram per context, Brotli-style complex/simple code descriptions.
 * Ports the relevant parts of libjxl enc_ans.cc / enc_huffman*.cc and the
 * hand-written writer in enc_fast_lossless.cc (PrefixCode::WriteTo).
 */

/** Hybrid uint config shared by every context: split_exponent 4, msb_in_token 1, lsb_in_token 0. */
const SPLIT_EXPONENT = 4;
const MSB_IN_TOKEN = 1;
const SPLIT = 1 << SPLIT_EXPONENT;

/** Number of distinct tokens a uint32 can map to (token of 0xFFFFFFFF is 71). */
export const JXL_ENC_NUM_TOKENS = 72;

const MAX_CODE_LENGTH = 15;

/** Token for `value` (uint32) under the hybrid uint config above (HybridUintConfig::Encode). */
export function hybridUintToken(value: number): number {
  if (value < SPLIT) return value;
  const n = 31 - Math.clz32(value);
  return SPLIT + ((n - SPLIT_EXPONENT) << MSB_IN_TOKEN) + ((value >>> (n - 1)) & 1);
}

/** Write `value`'s token with `code`, followed by its raw extra bits. */
function writeHybridUint(w: JxlBitWriter, code: PrefixCode, value: number, tokenOffset = 0): void {
  const token = hybridUintToken(value) + tokenOffset;
  w.writeBits(code.lengths[token]!, code.codes[token]!);
  if (value >= SPLIT) {
    const nbits = 30 - Math.clz32(value); // n - msb_in_token
    w.writeBits(nbits, (value & ((1 << nbits) - 1)) >>> 0);
  }
}

/** ceil(log2(x + 1)), the spec's field width for a value in [0, x]. */
function bitsFor(x: number): number {
  return 32 - Math.clz32(x);
}

/**
 * Optimal length-limited Huffman code lengths via package-merge.
 * Symbols with zero frequency get length 0. With a single used symbol it gets
 * length 1 (callers encode that case with a zero-bit code).
 */
export function buildCodeLengths(freqs: ArrayLike<number>, maxLength: number): Uint8Array {
  const lengths = new Uint8Array(freqs.length);
  const used: number[] = [];
  for (let s = 0; s < freqs.length; s++) if (freqs[s]! > 0) used.push(s);
  if (used.length === 0) return lengths;
  if (used.length === 1) {
    lengths[used[0]!] = 1;
    return lengths;
  }
  if (used.length > 2 ** maxLength) throw new Error('JXL: too many symbols for code length limit');
  type Item = { weight: number; symbols: number[] };
  const leaves: Item[] = used.map((s) => ({ weight: freqs[s]!, symbols: [s] })).toSorted((a, b) => a.weight - b.weight);
  let list = leaves;
  for (let level = 1; level < maxLength; level++) {
    const packages: Item[] = [];
    for (let i = 0; i + 1 < list.length; i += 2) {
      packages.push({
        weight: list[i]!.weight + list[i + 1]!.weight,
        symbols: list[i]!.symbols.concat(list[i + 1]!.symbols),
      });
    }
    // Merge two sorted lists; leaves first on ties keeps lengths short for leaves.
    const merged: Item[] = [];
    let a = 0;
    let b = 0;
    while (a < leaves.length || b < packages.length) {
      if (b >= packages.length || (a < leaves.length && leaves[a]!.weight <= packages[b]!.weight)) {
        merged.push(leaves[a++]!);
      } else {
        merged.push(packages[b++]!);
      }
    }
    list = merged;
  }
  for (let i = 0; i < 2 * used.length - 2; i++) {
    for (const s of list[i]!.symbols) lengths[s]!++;
  }
  return lengths;
}

/** Canonical (Deflate/Brotli) codes for `lengths`, bit-reversed for LSB-first writing. */
export function canonicalCodes(lengths: Uint8Array): Uint16Array {
  const blCount = new Uint16Array(MAX_CODE_LENGTH + 1);
  for (const len of lengths) if (len > 0) blCount[len]!++;
  const nextCode = new Uint16Array(MAX_CODE_LENGTH + 1);
  let code = 0;
  for (let bits = 1; bits <= MAX_CODE_LENGTH; bits++) {
    code = (code + blCount[bits - 1]!) << 1;
    nextCode[bits] = code;
  }
  const codes = new Uint16Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) {
    const len = lengths[s]!;
    if (len === 0) continue;
    const c = nextCode[len]!++;
    let rev = 0;
    for (let i = 0; i < len; i++) rev |= ((c >> i) & 1) << (len - 1 - i);
    codes[s] = rev;
  }
  return codes;
}

/** A prefix code over tokens [0, alphabetSize). All-zero lengths means a single zero-bit symbol. */
export interface PrefixCode {
  alphabetSize: number;
  lengths: Uint8Array;
  codes: Uint16Array;
}

export function buildPrefixCode(histogram: ArrayLike<number>): PrefixCode {
  let alphabetSize = 1;
  let used = 0;
  for (let s = 0; s < histogram.length; s++) {
    if (histogram[s]! > 0) {
      alphabetSize = s + 1;
      used++;
    }
  }
  const lengths =
    used > 1
      ? buildCodeLengths(Array.from(histogram).slice(0, alphabetSize), MAX_CODE_LENGTH)
      : new Uint8Array(alphabetSize);
  return { alphabetSize, lengths, codes: canonicalCodes(lengths) };
}

// Fixed code for code-length-code lengths 0..5 (Brotli), from enc_fast_lossless.cc.
const CL_LENGTH_NBITS = [2, 4, 3, 2, 2, 4];
const CL_LENGTH_BITS = [0, 7, 3, 2, 1, 15];
const CODE_LENGTH_ORDER = [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/** Write a prefix code description (Brotli simple or complex form; no run-length codes). */
function writePrefixCode(w: JxlBitWriter, code: PrefixCode): void {
  const { alphabetSize, lengths } = code;
  if (alphabetSize === 1) return;
  if (lengths.every((l) => l === 0)) {
    // Simple code with a single symbol: the last one, by construction.
    w.writeBits(2, 1); // HSKIP = 1 → simple
    w.writeBits(2, 0); // NSYM - 1
    w.writeBits(bitsFor(alphabetSize - 1), alphabetSize - 1);
    return;
  }
  const clFreq = new Uint32Array(18);
  for (const l of lengths) clFreq[l]!++;
  const clLengths = buildCodeLengths(clFreq, 5);
  const clSingle = clLengths.filter((l) => l > 0).length === 1;
  const clCodes = canonicalCodes(clLengths);
  w.writeBits(2, 0); // HSKIP = 0
  // Decoders stop once the code-length code is complete (Kraft sum 1); a single-symbol
  // code-length code never completes, so all 18 entries are written then.
  let count = 18;
  if (!clSingle) while (clLengths[CODE_LENGTH_ORDER[count - 1]!] === 0) count--;
  for (let i = 0; i < count; i++) {
    const l = clLengths[CODE_LENGTH_ORDER[i]!]!;
    w.writeBits(CL_LENGTH_NBITS[l]!, CL_LENGTH_BITS[l]!);
  }
  if (clSingle) return; // every code length is the single symbol, coded with zero bits
  // The last symbol has a nonzero length, which completes the Kraft sum, so decoders stop there.
  for (const l of lengths) w.writeBits(clLengths[l]!, clCodes[l]!);
}

function writeAlphabetSize(w: JxlBitWriter, size: number): void {
  if (size === 1) {
    w.writeBool(false);
    return;
  }
  w.writeBool(true);
  const n = 31 - Math.clz32(size - 1);
  w.writeBits(4, n);
  w.writeBits(n, size - 1 - (1 << n));
}

/** Context map with identity clustering (simple form when ≤ 3 bits per entry, else entropy coded). */
function writeContextMap(w: JxlBitWriter, numContexts: number, map?: Uint8Array): void {
  if (numContexts === 1) return;
  const nbits = bitsFor(map ? Math.max(...map) : numContexts - 1);
  if (nbits <= 3) {
    w.writeBool(true); // is_simple
    w.writeBits(2, nbits);
    for (let c = 0; c < numContexts; c++) w.writeBits(nbits, map?.[c] ?? c);
    return;
  }
  w.writeBool(false); // not simple
  w.writeBool(false); // no move-to-front
  const values = Array.from({ length: numContexts }, (_, c) => map?.[c] ?? c);
  const stream: TokenStream = { contexts: new Uint8Array(numContexts), values };
  const code = JxlEncEntropyCode.build(1, [stream]);
  code.writeHeader(w);
  code.writeStream(w, stream);
}

/** Symbols to encode: per-symbol context index and uint32 value. */
export interface TokenStream {
  contexts: ArrayLike<number>;
  values: ArrayLike<number>;
}

/** Entropy model built from the immutable streams it will encode. */
export class JxlEncEntropyCode {
  private measuredBits = 0;

  private constructor(
    private readonly codes: PrefixCode[],
    private readonly options: {
      lzStreams?: Map<TokenStream, LzStream>;
      ans?: JxlAnsCode;
      minSymbol?: number;
      numContexts?: number;
      contextMap?: Uint8Array;
    } = {},
  ) {}

  /** Exact entropy header + all model-stream payload bits, set by buildModular(). */
  get encodedSizeBits(): number {
    return this.measuredBits;
  }

  /** Compare complete headers and payloads for prefix/ANS, with and without LZ77.
   * Explicit distances use Modular's nonzero distance multiplier convention.
   * MA trees and context maps keep the prefix-only build() path.
   */
  static buildModular(numContexts: number, streams: TokenStream[], allowAns = false): JxlEncEntropyCode {
    const histogram = (count: number, encoded?: Map<TokenStream, LzStream>): Uint32Array[] => {
      const hist = Array.from({ length: count }, () => new Uint32Array(224 + JXL_ENC_NUM_TOKENS));
      for (const original of streams) {
        const lz = encoded?.get(original);
        const { contexts, values } = lz ?? original;
        for (let i = 0; i < values.length; i++)
          hist[contexts[i]!]![hybridUintToken(values[i]!) + (lz?.offsets[i] ?? 0)]!++;
      }
      return hist;
    };
    const rawHist = histogram(numContexts);
    const lzStreams = new Map(streams.map((stream) => [stream, lz77Tokens(stream, numContexts)]));
    const lzHist = histogram(numContexts + 1, lzStreams);
    const plain = new JxlEncEntropyCode(rawHist.map(buildPrefixCode));
    const prefixLz = new JxlEncEntropyCode(lzHist.map(buildPrefixCode), { lzStreams });
    const candidates = [plain, prefixLz];
    if (allowAns) {
      // Parsing is identical for both alphabets; only the length-symbol marker changes.
      const ansLzStreams = new Map(
        streams.map((stream) => {
          const lz = lzStreams.get(stream)!;
          const offsets = new Uint8Array(lz.offsets.length);
          for (let i = 0; i < offsets.length; i++) offsets[i] = lz.offsets[i] ? 128 : 0;
          return [stream, { ...lz, offsets }];
        }),
      );
      const ansHist = (hist: Uint32Array[], lz = false): Uint32Array[] =>
        hist.map((h) => {
          const out = new Uint32Array(256);
          out.set(h.subarray(0, JXL_ENC_NUM_TOKENS));
          if (lz) out.set(h.subarray(224), 128);
          return out;
        });
      candidates.push(
        new JxlEncEntropyCode([], { ans: new JxlAnsCode(ansHist(rawHist)), numContexts }),
        new JxlEncEntropyCode([], {
          ans: new JxlAnsCode(ansHist(lzHist, true)),
          lzStreams: ansLzStreams,
          minSymbol: 128,
          numContexts: numContexts + 1,
        }),
      );
    }
    let best = plain,
      bestSize = Infinity;
    for (let c = 0; c < candidates.length; c++) {
      const code = candidates[c]!;
      const w = new JxlBitWriter();
      code.writeHeader(w);
      let bits = w.bitPosition;
      if (code.options.ans) {
        for (const stream of streams) {
          const encoded = code.options.lzStreams?.get(stream);
          bits += code.options.ans.streamSizeBits(encoded ?? stream, encoded?.offsets);
        }
      } else {
        const hist = c === 0 ? rawHist : lzHist;
        for (let ctx = 0; ctx < hist.length; ctx++) {
          for (let token = 0; token < hist[ctx]!.length; token++) {
            const count = hist[ctx]![token]!;
            if (!count) continue;
            const uintToken = c === 1 && token >= 224 ? token - 224 : token;
            const extra = uintToken < 16 ? 0 : 3 + ((uintToken - 16) >> 1);
            bits += count * (code.codes[ctx]!.lengths[token]! + extra);
          }
        }
      }
      code.measuredBits = bits;
      if (bits < bestSize) {
        bestSize = bits;
        best = code;
      }
    }
    return best;
  }

  static build(numContexts: number, streams: TokenStream[], contextMap?: Uint8Array): JxlEncEntropyCode {
    const numClusters = contextMap ? Math.max(...contextMap) + 1 : numContexts;
    const histograms = Array.from({ length: numClusters }, () => new Uint32Array(JXL_ENC_NUM_TOKENS));
    for (const { contexts, values } of streams) {
      for (let i = 0; i < values.length; i++)
        histograms[contextMap?.[contexts[i]!] ?? contexts[i]!]![hybridUintToken(values[i]!)]!++;
    }
    return new JxlEncEntropyCode(histograms.map(buildPrefixCode), { contextMap });
  }

  /** Write LZ77 parameters, context map, hybrid uint configs and entropy histograms. */
  writeHeader(w: JxlBitWriter): void {
    w.writeBool(!!this.options.lzStreams);
    if (this.options.lzStreams) {
      w.writeU32(this.options.minSymbol ?? 224, 224, 512, 4096, { bits: 15, offset: 8 });
      w.writeU32(3, 3, 4, { bits: 2, offset: 5 }, { bits: 8, offset: 9 });
      w.writeBits(4, SPLIT_EXPONENT); // length config, log alphabet size 8
      w.writeBits(3, MSB_IN_TOKEN);
      w.writeBits(2, 0);
    }
    writeContextMap(
      w,
      this.options.contextMap?.length ?? this.options.numContexts ?? this.codes.length,
      this.options.contextMap,
    );
    w.writeBool(!this.options.ans); // use_prefix_code
    if (this.options.ans) w.writeBits(2, 3); // log alphabet size 8
    for (let c = 0; c < (this.options.numContexts ?? this.codes.length); c++) {
      w.writeBits(bitsFor(15), SPLIT_EXPONENT);
      w.writeBits(bitsFor(SPLIT_EXPONENT), MSB_IN_TOKEN);
      w.writeBits(bitsFor(SPLIT_EXPONENT - MSB_IN_TOKEN), 0); // lsb_in_token
    }
    if (this.options.ans) this.options.ans.writeHistograms(w);
    else {
      for (const code of this.codes) writeAlphabetSize(w, code.alphabetSize);
      for (const code of this.codes) writePrefixCode(w, code);
    }
  }

  writeStream(w: JxlBitWriter, stream: TokenStream): void {
    const encoded = this.options.lzStreams?.get(stream);
    if (this.options.lzStreams && !encoded) throw new Error('JXL: stream was not included in LZ77 model');
    const { contexts, values } = encoded ?? stream;
    if (this.options.ans) {
      this.options.ans.writeStream(w, encoded ?? stream, encoded?.offsets);
      return;
    }
    for (let i = 0; i < values.length; i++) {
      writeHybridUint(
        w,
        this.codes[this.options.contextMap?.[contexts[i]!] ?? contexts[i]!]!,
        values[i]!,
        encoded?.offsets[i] ?? 0,
      );
    }
  }
}

/** Estimated coded size in bits of `stream` (per-context token entropy plus raw extra bits). */
export function estimateStreamBits(stream: TokenStream, numContexts: number): number {
  return estimateContextBits([stream], numContexts).reduce((a, b) => a + b, 0);
}

/** Per-context token entropy plus hybrid uint extra bits, across all streams. */
export function estimateContextBits(streams: TokenStream[], numContexts: number): Float64Array {
  const histograms = Array.from({ length: numContexts }, () => new Float64Array(JXL_ENC_NUM_TOKENS));
  const bits = new Float64Array(numContexts);
  for (const stream of streams) {
    for (let i = 0; i < stream.values.length; i++) {
      const v = stream.values[i]!;
      const ctx = stream.contexts[i]!;
      histograms[ctx]![hybridUintToken(v)]!++;
      if (v >= SPLIT) bits[ctx]! += 30 - Math.clz32(v);
    }
  }
  for (let ctx = 0; ctx < numContexts; ctx++) {
    const h = histograms[ctx]!;
    let total = 0;
    for (const count of h) total += count;
    for (const count of h) if (count > 0) bits[ctx]! -= count * Math.log2(count / total);
  }
  return bits;
}

/** Map a signed integer to uint32: 0, -1, 1, -2, … → 0, 1, 2, 3, … */
export function packSigned(v: number): number {
  return v >= 0 ? 2 * v : -2 * v - 1;
}

interface LzStream extends TokenStream {
  offsets: ArrayLike<number>;
}

/** Linear-time greedy parser with a bounded hash table and JPEG XL's 1 Mi-sample window.
 * Matches may overlap and cross contexts: the decoder copies residual values before
 * consulting their context. Each stream starts with a fresh history, as the decoder does.
 */
function lz77Tokens(stream: TokenStream, distanceContext: number, minSymbol = 224): LzStream {
  const { values } = stream;
  const contexts = new Uint8Array(values.length);
  const output = new Uint32Array(values.length);
  const offsets = new Uint8Array(values.length);
  let count = 0;
  const last = new Int32Array(1 << 16).fill(-1);
  const hash = (i: number): number =>
    (Math.imul(values[i]!, 0x1e35a7bd) ^ Math.imul(values[i + 1]!, 0x9e3779b1) ^ values[i + 2]!) >>> 16;
  const push = (ctx: number, value: number, offset = 0): void => {
    contexts[count] = ctx;
    output[count] = value;
    offsets[count++] = offset;
  };
  for (let i = 0; i < values.length;) {
    let length = 0;
    let previous = -1;
    if (i + 7 < values.length) {
      const h = hash(i);
      previous = last[h]!;
      if (previous >= 0 && i - previous <= 1 << 20) {
        while (i + length < values.length && values[previous + length] === values[i + length]) length++;
      }
    }
    if (length >= 8) {
      push(stream.contexts[i]!, length - 3, minSymbol);
      push(distanceContext, i - previous + 119);
    } else {
      length = 1;
      push(stream.contexts[i]!, values[i]!);
    }
    for (let j = i; j < i + length && j + 2 < values.length; j++) last[hash(j)] = j;
    i += length;
  }
  return {
    contexts: contexts.subarray(0, count),
    values: output.subarray(0, count),
    offsets: offsets.subarray(0, count),
  };
}
