import { describe, expect, it } from 'vitest';
import { JxlBitReader } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import { JxlEncEntropyCode } from './jxlEncEntropy.js';
import {
  buildAnsAliasTable,
  buildPrefixCode,
  JxlEntropyDecoder,
  readAnsHistogram,
  readContextMap,
  readHybridUint,
  readHybridUintConfig,
  readPermutation,
  readPrefixCode,
} from './jxlEntropy.js';
import {
  ansReverseMap,
  encodeHybridUint,
  type EntropyOp,
  type EntropyStreamSpec,
  hybridConfig,
  normalizeCounts,
  writeAnsHistogram,
  writeEntropyStream,
  writeHybridUintConfig,
  writePrefixCode,
  writeVarLenUint8,
} from './jxlEntropyTestUtils.js';

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function reader(w: JxlBitWriter): JxlBitReader {
  return new JxlBitReader(w.finish());
}

function roundTrip(spec: EntropyStreamSpec, ops: EntropyOp[], distMultiplier = 0): number[] {
  const w = new JxlBitWriter();
  writeEntropyStream(w, spec, ops);
  w.writeBits(8, 0xa5); // sentinel: stream must end exactly here
  const br = reader(w);
  const dec = JxlEntropyDecoder.read(br, spec.numDists);
  const out = ops.flatMap((op) => {
    const n = 'copy' in op ? op.copy : 1;
    return Array.from({ length: n }, () => dec.readUint(br, op.ctx, distMultiplier));
  });
  dec.finish();
  expect(br.readBits(8)).toBe(0xa5);
  return out;
}

function randomOps(r: () => number, n: number, numCtx: number, maxValue: number): { ctx: number; value: number }[] {
  return Array.from({ length: n }, () => {
    const ctx = Math.floor(r() * numCtx);
    // Skewed values per context so histograms differ.
    const value = Math.floor(r() ** (ctx + 1) * maxValue);
    return { ctx, value };
  });
}

function decodeAll(freqs: number[], seq: number[], opts: { simple?: boolean; repeats?: boolean }): number[] {
  const w = new JxlBitWriter();
  const code = writePrefixCode(w, freqs, opts);
  for (const s of seq) w.writeBits(code.lengths[s], code.codes[s]);
  const br = reader(w);
  const p = readPrefixCode(br, freqs.length);
  return seq.map(() => {
    const idx = br.peekBits(p.bits);
    br.skipBits(p.lengths[idx]);
    return p.symbols[idx];
  });
}

function readBack(counts: Uint16Array, logAlpha: number, opts: Parameters<typeof writeAnsHistogram>[2]): Uint16Array {
  const w = new JxlBitWriter();
  writeAnsHistogram(w, counts, opts);
  w.writeBits(8, 0x5a);
  const br = reader(w);
  const got = readAnsHistogram(br, logAlpha);
  expect(br.readBits(8)).toBe(0x5a);
  return got;
}

function naive(size: number, skip: number, lehmer: number[]): number[] {
  const temp = Array.from({ length: size - skip }, (_, i) => i + skip);
  const out = Array.from({ length: skip }, (_, i) => i);
  for (const l of lehmer) out.push(temp.splice(l, 1)[0]);
  return [...out, ...temp];
}

const ctxOf = (x: number): number => Math.min(7, x === 0 ? 0 : 32 - Math.clz32(x));

function encode(size: number, skip: number, lehmer: number[], usePrefix: boolean): JxlBitReader {
  const ops: EntropyOp[] = [{ ctx: ctxOf(size), value: lehmer.length }];
  let prev = 0;
  for (const l of lehmer) {
    ops.push({ ctx: ctxOf(prev), value: l });
    prev = l;
  }
  const w = new JxlBitWriter();
  writeEntropyStream(w, { numDists: 8, usePrefix, logAlphaSize: 8 }, ops);
  return reader(w);
}

describe('hybrid uint', () => {
  const configs = [
    [0, 0, 0],
    [4, 2, 0],
    [4, 1, 0],
    [4, 0, 0],
    [3, 1, 1],
    [5, 2, 2],
    [8, 0, 0],
    [7, 3, 4],
    [15, 0, 0],
  ];
  const values = [
    0,
    1,
    2,
    3,
    7,
    8,
    15,
    16,
    17,
    31,
    255,
    256,
    1000,
    65535,
    65536,
    123456789,
    2 ** 31 - 1,
    2 ** 31,
    2 ** 32 - 1,
  ];

  it('round-trips (config, value) pairs including values ≥ 2^31', () => {
    for (const [se, msb, lsb] of configs) {
      const cfg = hybridConfig(se, msb, lsb);
      const w = new JxlBitWriter();
      for (const v of values) {
        const e = encodeHybridUint(cfg, v);
        w.writeBits(16, e.token);
        w.writeBits(e.nbits, e.bits);
      }
      const br = reader(w);
      for (const v of values) expect(readHybridUint(br, cfg, br.readBits(16))).toBe(v);
    }
  });

  it('matches known tokens for config (4, 2, 0)', () => {
    const cfg = hybridConfig(4, 2, 0);
    expect(encodeHybridUint(cfg, 15)).toEqual({ token: 15, nbits: 0, bits: 0 });
    // 16 = 1_00_00: n=4, msb bits 00 -> token 16, 2 raw bits
    expect(encodeHybridUint(cfg, 16)).toEqual({ token: 16, nbits: 2, bits: 0 });
    // 29 = 1_11_01 -> token 16 + 3 = 19, raw bits 01
    expect(encodeHybridUint(cfg, 29)).toEqual({ token: 19, nbits: 2, bits: 1 });
    expect(encodeHybridUint(cfg, 32).token).toBe(20);
  });

  it('reads configs and rejects invalid ones', () => {
    for (const logAlpha of [5, 6, 7, 8, 15]) {
      for (let se = 0; se <= logAlpha; se++) {
        for (let msb = 0; msb <= se; msb++) {
          for (let lsb = 0; msb + lsb <= se; lsb++) {
            if (se === logAlpha && (msb || lsb)) continue;
            const w = new JxlBitWriter();
            writeHybridUintConfig(w, hybridConfig(se, msb, lsb), logAlpha);
            expect(readHybridUintConfig(reader(w), logAlpha)).toEqual(hybridConfig(se, msb, lsb));
          }
        }
      }
    }
    // split_exponent 4 (3 bits for log_alpha 5), msb 5 > 4
    const w = new JxlBitWriter();
    w.writeBits(3, 4);
    w.writeBits(3, 5);
    expect(() => readHybridUintConfig(reader(w), 5)).toThrow(/hybrid uint/);
    // msb 2 + lsb 3 > split_exponent 4
    const w2 = new JxlBitWriter();
    w2.writeBits(3, 4);
    w2.writeBits(3, 2);
    w2.writeBits(2, 3);
    expect(() => readHybridUintConfig(reader(w2), 5)).toThrow(/hybrid uint/);
  });
});

describe('prefix codes', () => {
  it('builds canonical tables (Deflate order, LSB-first lookup)', () => {
    // Symbols A..D with lengths 2,1,3,3: codes B=0, A=10, C=110, D=111.
    const code = buildPrefixCode([2, 1, 3, 3]);
    expect(code.bits).toBe(3);
    const w = new JxlBitWriter();
    const emit = (len: number, msbFirst: number): void => {
      for (let b = len - 1; b >= 0; b--) w.writeBits(1, (msbFirst >> b) & 1);
    };
    emit(1, 0b0);
    emit(2, 0b10);
    emit(3, 0b110);
    emit(3, 0b111);
    const br = reader(w);
    const read = (): number => {
      const idx = br.peekBits(code.bits);
      br.skipBits(code.lengths[idx]);
      return code.symbols[idx];
    };
    expect([read(), read(), read(), read()]).toEqual([1, 0, 2, 3]);
    expect(br.bitPosition).toBe(9);
  });

  it('rejects incomplete or over-subscribed codes and handles single symbols', () => {
    expect(() => buildPrefixCode([1, 2])).toThrow(/incomplete/);
    expect(() => buildPrefixCode([1, 1, 1])).toThrow(/incomplete/);
    expect(() => buildPrefixCode([0, 0])).toThrow(/empty/);
    const single = buildPrefixCode([0, 0, 5]);
    expect(single.bits).toBe(0);
    expect(single.symbols[0]).toBe(2);
  });

  it('decodes simple codes with NSYM 1-4 and tree-select', () => {
    const cases: number[][] = [
      [0, 0, 7, 0],
      [3, 0, 0, 5],
      [1, 9, 0, 4, 0],
      [5, 5, 5, 5, 0, 0],
      [100, 30, 0, 0, 2, 1], // tree-select (lengths 1,2,3,3)
    ];
    for (const freqs of cases) {
      // Every used symbol, highest first.
      const seq = freqs.flatMap((_, i) => {
        const sym = freqs.length - 1 - i;
        return Array.from({ length: Math.min(freqs[sym], 6) }, () => sym);
      });
      expect(decodeAll(freqs, seq, { simple: true })).toEqual(seq);
    }
  });

  it('decodes complex codes with and without repeat codes 16/17 (including chained repeats)', () => {
    const r = rng(1);
    for (let trial = 0; trial < 40; trial++) {
      const size = 2 + Math.floor(r() * (trial < 20 ? 40 : 3000));
      const freqs = Array.from({ length: size }, () => (r() < 0.6 ? 0 : 1 + Math.floor(r() ** 3 * 1000)));
      freqs[0] = 1;
      freqs[size - 1] = 3;
      // Long runs of equal lengths/zeros exercise chained 16/17 codes.
      if (trial % 3 === 0) for (let i = 1; i < Math.min(size - 1, 200); i++) freqs[i] = 0;
      if (trial % 3 === 1) for (let i = 1; i < Math.min(size - 1, 64); i++) freqs[i] = 50;
      const seq = Array.from({ length: 200 }, () => {
        for (;;) {
          const s = Math.floor(r() * size);
          if (freqs[s]) return s;
        }
      });
      for (const repeats of [false, true]) expect(decodeAll(freqs, seq, { repeats })).toEqual(seq);
    }
  });

  it('handles alphabet size 1 and 2^15', () => {
    const one = readPrefixCode(new JxlBitReader(new Uint8Array(4)), 1);
    expect(one.bits).toBe(0);
    const freqs = Array.from({ length: 1 << 15 }, () => 0);
    freqs[0] = 1;
    freqs[12345] = 2;
    freqs[32767] = 4;
    expect(decodeAll(freqs, [32767, 12345, 0, 32767], {})).toEqual([32767, 12345, 0, 32767]);
  });

  it('rejects corrupt prefix codes', () => {
    // Simple code with duplicate symbols.
    const dup = new JxlBitWriter();
    dup.writeBits(2, 1);
    dup.writeBits(2, 1);
    dup.writeBits(3, 5);
    dup.writeBits(3, 5);
    expect(() => readPrefixCode(reader(dup), 8)).toThrow(/simple prefix/);
    // Simple code symbol out of range.
    const oob = new JxlBitWriter();
    oob.writeBits(2, 1);
    oob.writeBits(2, 0);
    oob.writeBits(3, 6);
    expect(() => readPrefixCode(reader(oob), 6)).toThrow(/simple prefix/);
    // Complex code that never completes (all zeros).
    expect(() => readPrefixCode(new JxlBitReader(new Uint8Array(16)), 10)).toThrow();
    // Too large an alphabet.
    expect(() => readPrefixCode(new JxlBitReader(new Uint8Array(4)), (1 << 15) + 1)).toThrow(/too large/);
  });
});

describe('ANS histograms', () => {
  it('reads simple one- and two-symbol histograms', () => {
    const c1 = new Uint16Array(32);
    c1[17] = 4096;
    expect(readBack(c1, 5, {})).toEqual(c1);
    const c2 = new Uint16Array(64);
    c2[3] = 1000;
    c2[40] = 3096;
    expect(readBack(c2, 6, {})).toEqual(c2);
  });

  it('reads flat histograms', () => {
    const w = new JxlBitWriter();
    w.writeBits(1, 0);
    w.writeBits(1, 1);
    writeVarLenUint8(w, 6); // alphabet 7
    const got = readAnsHistogram(reader(w), 5);
    expect(Array.from(got.subarray(0, 8))).toEqual([586, 585, 585, 585, 585, 585, 585, 0]);
    expect(got.reduce((a, b) => a + b, 0)).toBe(4096);
  });

  it('round-trips compressed histograms with and without RLE for log_alpha_size 5..8', () => {
    const r = rng(7);
    for (let logAlpha = 5; logAlpha <= 8; logAlpha++) {
      for (let trial = 0; trial < 30; trial++) {
        const size = 1 + Math.floor(r() * (1 << logAlpha));
        const freqs = Array.from({ length: size }, () => (r() < 0.3 ? 0 : Math.floor(r() ** 4 * 5000)));
        if (trial % 4 === 0) freqs.fill(9, 0, size); // long equal runs for RLE
        if (trial % 4 === 1) freqs.fill(0, 1, size - 1);
        const counts = normalizeCounts(freqs, 1 << logAlpha);
        expect(readBack(counts, logAlpha, { mode: 'compressed' })).toEqual(counts);
        expect(readBack(counts, logAlpha, { mode: 'compressed', rle: true })).toEqual(counts);
      }
    }
  });

  it('rejects corrupt histograms', () => {
    // Two-symbol histogram with identical symbols.
    const same = new JxlBitWriter();
    same.writeBits(2, 0b11);
    writeVarLenUint8(same, 2);
    writeVarLenUint8(same, 2);
    expect(() => readAnsHistogram(reader(same), 5)).toThrow(/invalid ANS/);
    // Symbol outside the alphabet.
    const big = new JxlBitWriter();
    big.writeBits(2, 0b01);
    writeVarLenUint8(big, 40);
    expect(() => readAnsHistogram(reader(big), 5)).toThrow(/out of range/);
    // Flat alphabet larger than the table.
    const flat = new JxlBitWriter();
    flat.writeBits(2, 0b10);
    writeVarLenUint8(flat, 40);
    expect(() => readAnsHistogram(reader(flat), 5)).toThrow(/too large/);
    // Compressed counts summing past 4096: shift 13, length 3, logcounts 11, 11, 11 (one omitted), extra bits all ones.
    const over = new JxlBitWriter();
    over.writeBits(2, 0);
    over.writeBits(3, 0b111);
    over.writeBits(3, 6);
    writeVarLenUint8(over, 0);
    // logcount 11 -> table value 12 at index 1 (7 bits)
    for (let i = 0; i < 3; i++) over.writeBits(7, 1);
    over.writeBits(11, 0x7ff);
    over.writeBits(11, 0x7ff);
    expect(() => readAnsHistogram(reader(over), 5)).toThrow(/count/);
  });

  it('builds alias tables that map the 4096 states bijectively onto (symbol, offset)', () => {
    const r = rng(3);
    for (let logAlpha = 5; logAlpha <= 8; logAlpha++) {
      for (let trial = 0; trial < 20; trial++) {
        const size = 1 + Math.floor(r() * (1 << logAlpha));
        const freqs = Array.from({ length: size }, () => (r() < 0.4 ? 0 : Math.floor(r() ** 3 * 100)));
        const counts = normalizeCounts(freqs, 1 << logAlpha);
        const rev = ansReverseMap(counts, logAlpha);
        const seen = new Set<number>();
        for (let s = 0; s < counts.length; s++) {
          const slots = rev[s];
          expect(slots.length).toBe(counts[s]);
          for (const slot of slots) {
            expect(slot).toBeDefined();
            seen.add(slot);
          }
        }
        expect(seen.size).toBe(4096);
      }
    }
  });

  it('keeps the state unchanged for single-symbol distributions', () => {
    const counts = new Uint16Array(32);
    counts[5] = 4096;
    const t = buildAnsAliasTable(counts, 5);
    for (let i = 0; i < 32; i++) {
      expect(t.cutoff[i]).toBe(0);
      expect(t.rightValue[i]).toBe(5);
      expect(t.offset1[i]).toBe(i * 128);
      expect(t.freq1[i]).toBe(4096);
    }
  });

  it('matches libjxl InitAliasTable on a hand-computed example', () => {
    // log_alpha_size 5 -> 32 buckets of 128; counts [3000, 1000, 96]. Overfull stack [0, 1], underfull [2..31]:
    // symbol 1 (popped first) fills buckets 31..25, then itself becomes underfull and symbol 0 fills 1, 24..3, 2.
    const counts = new Uint16Array(32);
    counts[0] = 3000;
    counts[1] = 1000;
    counts[2] = 96;
    const t = buildAnsAliasTable(counts, 5);
    expect([t.rightValue[31], t.cutoff[31], t.offset1[31], t.freq1[31]]).toEqual([1, 0, 872, 1000]);
    expect([t.rightValue[25], t.offset1[25]]).toEqual([1, 104]);
    expect([t.rightValue[1], t.cutoff[1], t.offset1[1], t.freq0[1], t.freq1[1]]).toEqual([0, 104, 2872, 1000, 3000]);
    expect([t.rightValue[24], t.offset1[24]]).toEqual([0, 2848]);
    expect([t.rightValue[2], t.cutoff[2], t.offset1[2]]).toEqual([0, 96, 32]);
    expect([t.rightValue[0], t.cutoff[0], t.offset1[0]]).toEqual([0, 0, 0]);
  });
});

describe('context map', () => {
  const maps = [
    [0, 1, 0, 2, 2, 1],
    [3, 3, 2, 1, 0, 0, 0, 3],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 9, 9, 9],
    Array.from({ length: 300 }, (_, i) => (i * 7) % 256),
  ];
  const modes = ['simple', 'prefix', 'ans', 'prefix-mtf', 'ans-mtf'] as const;

  it('round-trips all encodings including MTF', () => {
    for (const map of maps) {
      for (const mode of modes) {
        if (mode === 'simple' && Math.max(...map) >= 8) continue;
        const w = new JxlBitWriter();
        // writeEntropyStream writes LZ77 flag first; emulate just the map by a 1-symbol stream header.
        writeEntropyStream(w, { numDists: map.length, contextMap: map, contextMapMode: mode, usePrefix: true }, []);
        const br = reader(w);
        expect(br.readBool()).toBe(false); // lz77
        expect(Array.from(readContextMap(br, map.length))).toEqual(map);
      }
    }
  });

  it('is trivial for a single distribution and rejects holes', () => {
    expect(Array.from(readContextMap(new JxlBitReader(new Uint8Array(1)), 1))).toEqual([0]);
    const w = new JxlBitWriter();
    w.writeBits(1, 1);
    w.writeBits(2, 2);
    for (const v of [0, 2, 0]) w.writeBits(2, v);
    expect(() => readContextMap(reader(w), 3)).toThrow(/holes/);
  });

  it('rejects LZ77 inside a context map of ≤ 2 entries', () => {
    const w = new JxlBitWriter();
    w.writeBits(1, 0); // not simple
    w.writeBits(1, 0); // no MTF
    w.writeBool(true); // nested LZ77 enabled
    expect(() => readContextMap(reader(w), 2)).toThrow(/LZ77/);
  });
});

describe('JxlEntropyDecoder streams', () => {
  it('round-trips prefix-coded streams with clustering', () => {
    const r = rng(11);
    for (let trial = 0; trial < 12; trial++) {
      const numDists = 1 + (trial % 6);
      const contextMap = Array.from({ length: numDists }, (_, i) => Math.min(i, Math.max(0, numDists - 3)));
      const numClusters = Math.max(...contextMap) + 1;
      const configs = Array.from(
        { length: numClusters },
        (_, i) => [hybridConfig(4, 2, 0), hybridConfig(0, 0, 0), hybridConfig(8, 1, 3)][i % 3],
      );
      const ops = randomOps(r, 500, numDists, trial % 2 ? 2 ** 32 : 300);
      const spec = { numDists, contextMap, configs, usePrefix: true, simplePrefix: trial % 3 === 0 };
      expect(roundTrip(spec, ops)).toEqual(ops.map((o) => o.value));
    }
  });

  it('round-trips ANS streams for log_alpha_size 5..8 and histogram encodings', () => {
    const r = rng(12);
    for (let logAlpha = 5; logAlpha <= 8; logAlpha++) {
      for (const ansMode of ['auto', 'compressed'] as const) {
        for (const ansRle of [false, true]) {
          const numDists = 4;
          const configs = Array.from({ length: numDists }, () => hybridConfig(Math.min(4, logAlpha - 1), 0, 0));
          // Values with tokens < 2^logAlpha: config (se, 0, 0) yields token se + n - se + 1 ... keep values < 2^20.
          const ops = randomOps(r, 2000, numDists, 1 << 20);
          const spec: EntropyStreamSpec = {
            numDists,
            configs,
            usePrefix: false,
            logAlphaSize: logAlpha,
            ansMode,
            ansRle,
          };
          expect(roundTrip(spec, ops)).toEqual(ops.map((o) => o.value));
        }
      }
    }
  });

  it('round-trips ANS with single-symbol and two-symbol contexts and 32-bit values', () => {
    const ops: EntropyOp[] = [];
    for (let i = 0; i < 300; i++) {
      ops.push({ ctx: 0, value: 7 }); // single symbol: state never changes
      ops.push({ ctx: 1, value: i % 5 === 0 ? 1 : 0 });
      ops.push({ ctx: 2, value: 2 ** 31 + i * 12345 });
      ops.push({ ctx: 2, value: 2 ** 32 - 1 - i });
    }
    const spec: EntropyStreamSpec = {
      numDists: 3,
      usePrefix: false,
      logAlphaSize: 8,
      configs: [hybridConfig(4, 2, 0), hybridConfig(4, 2, 0), hybridConfig(4, 2, 1)],
    };
    expect(roundTrip(spec, ops)).toEqual(ops.map((o) => ('value' in o ? o.value : 0)));
  });

  it('throws on an ANS final-state mismatch', () => {
    const ops = randomOps(rng(5), 100, 2, 50);
    const w = new JxlBitWriter();
    writeEntropyStream(w, { numDists: 2, usePrefix: false, logAlphaSize: 6, badFinalState: true }, ops);
    const br = reader(w);
    const dec = JxlEntropyDecoder.read(br, 2);
    for (const op of ops) dec.readUint(br, op.ctx);
    expect(() => dec.finish()).toThrow(/final state/);

    // Stopping early also leaves a non-final state.
    const w2 = new JxlBitWriter();
    writeEntropyStream(w2, { numDists: 2, usePrefix: false, logAlphaSize: 6 }, ops);
    const br2 = reader(w2);
    const dec2 = JxlEntropyDecoder.read(br2, 2);
    for (const op of ops.slice(0, 50)) dec2.readUint(br2, op.ctx);
    expect(() => dec2.finish()).toThrow(/final state/);
  });

  it('clone() shares histograms with fresh state', () => {
    const ops = randomOps(rng(9), 200, 3, 1000);
    const w = new JxlBitWriter();
    writeEntropyStream(w, { numDists: 3, usePrefix: false, logAlphaSize: 7 }, ops);
    const bytes = w.finish();
    const br = new JxlBitReader(bytes);
    const dec = JxlEntropyDecoder.read(br, 3);
    const start = br.bitPosition;
    for (const pass of [dec, dec.clone()]) {
      const r = new JxlBitReader(bytes);
      r.skip(start);
      expect(ops.map((o) => pass.readUint(r, o.ctx))).toEqual(ops.map((o) => o.value));
      pass.finish();
    }
  });

  it('decodes streams from the hdrify JXL prefix encoder', () => {
    const r = rng(21);
    const numContexts = 9; // > 8 forces an entropy-coded context map
    const contexts = Array.from({ length: 1000 }, () => Math.floor(r() * numContexts));
    const values = contexts.map((c) => Math.floor(r() ** (c + 1) * 2 ** 32));
    const stream = { contexts, values };
    const code = JxlEncEntropyCode.build(numContexts, [stream]);
    const w = new JxlBitWriter();
    code.writeHeader(w);
    code.writeStream(w, stream);
    const br = reader(w);
    const dec = JxlEntropyDecoder.read(br, numContexts);
    expect(contexts.map((c) => dec.readUint(br, c))).toEqual(values);
  });
});

describe('LZ77', () => {
  const lz77 = { minSymbol: 224, minLength: 3, lengthConfig: hybridConfig(4, 1, 0) };

  for (const usePrefix of [true, false]) {
    const base: EntropyStreamSpec = { numDists: 2, lz77, usePrefix, logAlphaSize: 8, contextMap: [0, 1, 2] };

    it(`copies with plain distances (${usePrefix ? 'prefix' : 'ANS'})`, () => {
      const ops: EntropyOp[] = [
        { ctx: 0, value: 10 },
        { ctx: 1, value: 20 },
        { ctx: 0, value: 30 },
        { ctx: 0, copy: 5, distance: 2 }, // distance 3: 10 20 30 10 20
        { ctx: 1, value: 99 },
        { ctx: 0, copy: 40, distance: 0 }, // distance 1: overlapping run of 99
        { ctx: 0, copy: 4, distance: 1000 }, // beyond decoded prefix: clamped to start
      ];
      const expected = [10, 20, 30, 10, 20, 30, 10, 20, 99, ...Array.from({ length: 40 }, () => 99), 10, 20, 30, 10];
      expect(roundTrip(base, ops)).toEqual(expected);
    });

    it(`copies zeros before anything is decoded (${usePrefix ? 'prefix' : 'ANS'})`, () => {
      const ops: EntropyOp[] = [
        { ctx: 0, copy: 6, distance: 0 },
        { ctx: 1, value: 5 },
        { ctx: 0, copy: 3, distance: 0 },
      ];
      expect(roundTrip(base, ops)).toEqual([0, 0, 0, 0, 0, 0, 5, 5, 5, 5]);
    });

    it(`maps special distances with a multiplier (${usePrefix ? 'prefix' : 'ANS'})`, () => {
      const width = 4;
      const row0 = [1, 2, 3, 4];
      const ops: EntropyOp[] = row0.map((value) => ({ ctx: 0, value }));
      ops.push({ ctx: 0, copy: 4, distance: 0 }); // (0,1): one row up -> 1 2 3 4
      ops.push({ ctx: 0, copy: 3, distance: 1 }); // (1,0): previous sample -> 4 4 4
      ops.push({ ctx: 0, copy: 3, distance: 3 }); // (-1,1): width - 1 = 3 back
      ops.push({ ctx: 0, copy: 3, distance: 120 + 4 }); // plain distance 5
      ops.push({ ctx: 0, copy: 3, distance: 9 }); // (-2,1): width - 2 = 2 back
      const out = roundTrip(base, ops, width);
      const exp = [...row0];
      const copy = (n: number, d: number): void => {
        for (let i = 0; i < n; i++) exp.push(exp[exp.length - d]);
      };
      copy(4, 4);
      copy(3, 1);
      copy(3, 3);
      copy(3, 5);
      copy(3, 2);
      expect(out).toEqual(exp);
    });
  }

  it('clamps special distances below 1 and handles long copies', () => {
    // Special distance 11 = (-2, 2) with multiplier 1 -> 0 -> clamped to 1.
    const spec: EntropyStreamSpec = {
      numDists: 1,
      lz77: { ...lz77, minSymbol: 64, minLength: 4 },
      usePrefix: false,
      logAlphaSize: 7,
    };
    const ops: EntropyOp[] = [
      { ctx: 0, value: 3 },
      { ctx: 0, copy: 5, distance: 11 },
      { ctx: 0, value: 4 },
      { ctx: 0, copy: 70000, distance: 120 + 1 },
    ];
    const out = roundTrip(spec, ops, 1);
    const exp = [3, 3, 3, 3, 3, 3, 4];
    for (let i = 0; i < 70000; i++) exp.push(exp[exp.length - 2]);
    expect(out).toEqual(exp);
  });
});

describe('readPermutation', () => {
  it('decodes random Lehmer codes with skip', () => {
    const r = rng(33);
    for (let trial = 0; trial < 30; trial++) {
      const size = 1 + Math.floor(r() * (trial < 25 ? 70 : 5000));
      const skip = Math.floor(r() * Math.min(size, 5));
      const end = Math.floor(r() * (size - skip + 1));
      const lehmer = Array.from({ length: end }, (_, i) => Math.floor(r() * (size - skip - i)));
      const br = encode(size, skip, lehmer, trial % 2 === 0);
      const dec = JxlEntropyDecoder.read(br, 8);
      const perm = readPermutation(br, dec, size, skip);
      dec.finish();
      expect(perm).toEqual(naive(size, skip, lehmer));
    }
  });

  it('decodes a hand-made code', () => {
    // size 5, skip 1, lehmer [2, 0, 1]: remaining [1,2,3,4] -> 3, 1, 4, 2
    const br = encode(5, 1, [2, 0, 1], true);
    expect(readPermutation(br, JxlEntropyDecoder.read(br, 8), 5, 1)).toEqual([0, 3, 1, 4, 2]);
  });

  it('rejects invalid sizes and Lehmer values', () => {
    const br = encode(4, 0, [0, 0, 0, 0, 0], true);
    expect(() => readPermutation(br, JxlEntropyDecoder.read(br, 8), 4, 0)).toThrow(/permutation size/);
    const br2 = encode(4, 0, [0, 3, 0], true);
    expect(() => readPermutation(br2, JxlEntropyDecoder.read(br2, 8), 4, 0)).toThrow(/Lehmer/);
  });
});
