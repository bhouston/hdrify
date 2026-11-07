import { JxlBitWriter } from './jxlBitWriter.js';

/**
 * Prefix-code (Huffman) entropy coder for JPEG XL, the encoder side of the
 * spec's "entropy-coded stream": no LZ77, identity context clustering, one
 * prefix code per context, Brotli-style complex/simple code descriptions.
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
function writeContextMap(w: JxlBitWriter, numContexts: number): void {
  if (numContexts === 1) return;
  const nbits = bitsFor(numContexts - 1);
  if (nbits <= 3) {
    w.writeBool(true); // is_simple
    w.writeBits(2, nbits);
    for (let c = 0; c < numContexts; c++) w.writeBits(nbits, c);
    return;
  }
  w.writeBool(false); // not simple
  w.writeBool(false); // no move-to-front
  const values = Array.from({ length: numContexts }, (_, c) => c);
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

/** Entropy code (one prefix code per context) built from the streams it will encode. */
export class JxlEncEntropyCode {
  private constructor(
    private readonly codes: PrefixCode[],
    private readonly lzStreams?: Map<TokenStream, LzStream>,
  ) {}

  /** Choose LZ77 only when the complete coded header and payload are smaller.
   * Explicit distances use Modular's nonzero distance multiplier convention.
   */
  static buildModular(numContexts: number, streams: TokenStream[]): JxlEncEntropyCode {
    const plain = JxlEncEntropyCode.build(numContexts, streams);
    const lzStreams = new Map(streams.map((stream) => [stream, lz77Tokens(stream, numContexts)]));
    const histograms = Array.from({ length: numContexts + 1 }, () => new Uint32Array(224 + JXL_ENC_NUM_TOKENS));
    for (const stream of lzStreams.values()) {
      for (let i = 0; i < stream.values.length; i++) {
        histograms[stream.contexts[i]!]![hybridUintToken(stream.values[i]!) + stream.offsets[i]!]!++;
      }
    }
    const lz = new JxlEncEntropyCode(histograms.map(buildPrefixCode), lzStreams);
    const size = (code: JxlEncEntropyCode): number => {
      const w = new JxlBitWriter();
      code.writeHeader(w);
      for (const stream of streams) code.writeStream(w, stream);
      return w.bitPosition;
    };
    return size(lz) < size(plain) ? lz : plain;
  }

  static build(numContexts: number, streams: TokenStream[]): JxlEncEntropyCode {
    const histograms = Array.from({ length: numContexts }, () => new Uint32Array(JXL_ENC_NUM_TOKENS));
    for (const { contexts, values } of streams) {
      for (let i = 0; i < values.length; i++) histograms[contexts[i]!]![hybridUintToken(values[i]!)]!++;
    }
    return new JxlEncEntropyCode(histograms.map(buildPrefixCode));
  }

  /** Write the stream header: LZ77 off, context map, hybrid uint configs and prefix codes. */
  writeHeader(w: JxlBitWriter): void {
    w.writeBool(!!this.lzStreams);
    if (this.lzStreams) {
      w.writeU32(224, 224, 512, 4096, { bits: 15, offset: 8 });
      w.writeU32(3, 3, 4, { bits: 2, offset: 5 }, { bits: 8, offset: 9 });
      w.writeBits(4, SPLIT_EXPONENT); // length config, log alphabet size 8
      w.writeBits(3, MSB_IN_TOKEN);
      w.writeBits(2, 0);
    }
    writeContextMap(w, this.codes.length);
    w.writeBool(true); // use_prefix_code (log_alphabet_size = 15)
    for (let c = 0; c < this.codes.length; c++) {
      w.writeBits(bitsFor(15), SPLIT_EXPONENT);
      w.writeBits(bitsFor(SPLIT_EXPONENT), MSB_IN_TOKEN);
      w.writeBits(bitsFor(SPLIT_EXPONENT - MSB_IN_TOKEN), 0); // lsb_in_token
    }
    for (const code of this.codes) writeAlphabetSize(w, code.alphabetSize);
    for (const code of this.codes) writePrefixCode(w, code);
  }

  writeStream(w: JxlBitWriter, stream: TokenStream): void {
    const encoded = this.lzStreams?.get(stream);
    if (this.lzStreams && !encoded) throw new Error('JXL: stream was not included in LZ77 model');
    const { contexts, values } = encoded ?? stream;
    for (let i = 0; i < values.length; i++) {
      writeHybridUint(w, this.codes[contexts[i]!]!, values[i]!, encoded?.offsets[i] ?? 0);
    }
  }
}

/** Estimated coded size in bits of `stream` (per-context token entropy plus raw extra bits). */
export function estimateStreamBits(stream: TokenStream, numContexts: number): number {
  const histograms = Array.from({ length: numContexts }, () => new Float64Array(JXL_ENC_NUM_TOKENS));
  let bits = 0;
  for (let i = 0; i < stream.values.length; i++) {
    const v = stream.values[i]!;
    histograms[stream.contexts[i]!]![hybridUintToken(v)]!++;
    if (v >= SPLIT) bits += 30 - Math.clz32(v);
  }
  for (const h of histograms) {
    let total = 0;
    for (const count of h) total += count;
    for (const count of h) if (count > 0) bits -= count * Math.log2(count / total);
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
function lz77Tokens(stream: TokenStream, distanceContext: number): LzStream {
  const { values } = stream;
  const contexts = new Uint8Array(values.length);
  const output = new Float64Array(values.length);
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
      push(stream.contexts[i]!, length - 3, 224);
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
