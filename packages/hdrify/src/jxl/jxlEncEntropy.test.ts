import { describe, expect, it } from 'vitest';
import { JxlBitReader } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import {
  buildCodeLengths,
  buildPrefixCode,
  canonicalCodes,
  estimateStreamBits,
  hybridUintToken,
  JxlEncEntropyCode,
  packSigned,
  type TokenStream,
} from './jxlEncEntropy.js';
import { JxlEntropyDecoder, readContextMap, readHybridUintConfig } from './jxlEntropy.js';

function kraftSum(lengths: Uint8Array): number {
  let sum = 0;
  for (const l of lengths) if (l > 0) sum += 2 ** -l;
  return sum;
}

function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 2 ** 32;
  };
}

describe('buildCodeLengths', () => {
  it('builds optimal lengths for a small known histogram', () => {
    expect(Array.from(buildCodeLengths([1, 1, 2, 4], 15))).toEqual([3, 3, 2, 1]);
    expect(Array.from(buildCodeLengths([5, 0, 5], 15))).toEqual([1, 0, 1]);
  });

  it('satisfies Kraft equality for random histograms', () => {
    const rand = rng(7);
    for (let trial = 0; trial < 50; trial++) {
      const n = 2 + Math.floor(rand() * 70);
      const freqs = Array.from({ length: n }, () => (rand() < 0.3 ? 0 : Math.floor(rand() ** 4 * 1e6) + 1));
      freqs[0] = 1;
      freqs[n - 1] = 3;
      const lengths = buildCodeLengths(freqs, 15);
      expect(kraftSum(lengths)).toBe(1);
      for (let s = 0; s < n; s++) expect(lengths[s] > 0).toBe(freqs[s] > 0);
    }
  });

  it('respects the length limit on exponentially skewed histograms', () => {
    const fib = [1, 1];
    while (fib.length < 40) fib.push(fib.at(-1)! + fib.at(-2)!);
    for (const [n, limit] of [
      [40, 15],
      [16, 5],
      [18, 5],
      [32, 5],
    ] as const) {
      const lengths = buildCodeLengths(fib.slice(0, n), limit);
      expect(Math.max(...lengths)).toBe(limit);
      expect(kraftSum(lengths)).toBe(1);
    }
    expect(() =>
      buildCodeLengths(
        Array.from({ length: 33 }, () => 1),
        5,
      ),
    ).toThrow();
  });

  it('gives a lone symbol length 1 and an empty histogram nothing', () => {
    expect(Array.from(buildCodeLengths([0, 9, 0], 15))).toEqual([0, 1, 0]);
    expect(Array.from(buildCodeLengths([0, 0], 15))).toEqual([0, 0]);
  });
});

describe('canonicalCodes', () => {
  it('assigns prefix-free bit-reversed canonical codes', () => {
    const lengths = new Uint8Array([3, 3, 2, 1, 0]);
    // Canonical MSB-first: sym3 = 0, sym2 = 10, sym0 = 110, sym1 = 111; stored bit-reversed.
    expect(Array.from(canonicalCodes(lengths))).toEqual([0b011, 0b111, 0b01, 0b0, 0]);
    const big = buildCodeLengths(
      Array.from({ length: 60 }, (_, i) => (i * 37) % 101),
      15,
    );
    const codes = canonicalCodes(big);
    const words = Array.from(big, (l, s) =>
      l ? codes[s].toString(2).padStart(l, '0').split('').toReversed().join('') : '',
    );
    for (const a of words) {
      for (const b of words) if (a && b && a !== b) expect(b.startsWith(a)).toBe(false);
    }
  });
});

describe('hybridUintToken / packSigned', () => {
  it('maps values to split-exponent 4, msb-in-token 1 tokens', () => {
    expect([0, 15, 16, 23, 24, 31, 32, 48].map(hybridUintToken)).toEqual([0, 15, 16, 16, 17, 17, 18, 19]);
    expect(hybridUintToken(0xffffffff)).toBe(71);
    expect([0, -1, 1, -2, 2147483647, -2147483648].map(packSigned)).toEqual([0, 1, 2, 3, 4294967294, 4294967295]);
  });
});

describe('JxlEncEntropyCode round-trips through the decoder', () => {
  function roundTrip(numContexts: number, stream: TokenStream): void {
    const code = JxlEncEntropyCode.build(numContexts, [stream]);
    const w = new JxlBitWriter();
    code.writeHeader(w);
    code.writeStream(w, stream);
    w.writeBits(13, 0x1abc); // sentinel: the stream must end exactly where we stopped writing
    const br = new JxlBitReader(w.finish());
    const dec = JxlEntropyDecoder.read(br, numContexts);
    dec.begin(br);
    for (let i = 0; i < stream.values.length; i++) {
      expect(dec.readUint(br, stream.contexts[i])).toBe(stream.values[i]);
    }
    expect(br.readBits(13)).toBe(0x1abc);
  }

  it('handles empty, single-symbol and two-symbol contexts', () => {
    roundTrip(1, { contexts: [0, 0, 0], values: [0, 0, 0] });
    roundTrip(1, { contexts: [0, 0], values: [5, 5] }); // single non-zero symbol
    roundTrip(1, { contexts: [0, 0, 0], values: [1, 7, 7] });
    roundTrip(3, { contexts: [2, 2, 0], values: [3, 1, 40] }); // context 1 unused
    roundTrip(2, { contexts: [0, 1, 0, 1], values: [4, 4, 4, 4] }); // equal lengths everywhere
  });

  it('handles random values up to 2^32 - 1 across many contexts', () => {
    const rand = rng(99);
    for (const numContexts of [1, 6, 8, 9, 40]) {
      const n = 3000;
      const contexts = Array.from({ length: n }, () => Math.floor(rand() * numContexts));
      const values = Array.from({ length: n }, () => {
        const r = rand();
        if (r < 0.6) return Math.floor(rand() * 20);
        if (r < 0.95) return Math.floor(rand() * 5000);
        return Math.floor(rand() * 2 ** 32);
      });
      values[0] = 0xffffffff;
      roundTrip(numContexts, { contexts, values });
    }
  });

  it('estimateStreamBits is close to the coded size', () => {
    const rand = rng(3);
    const values = Array.from({ length: 20000 }, () => Math.floor(rand() ** 3 * 3000));
    const stream = { contexts: new Uint8Array(values.length), values };
    const code = JxlEncEntropyCode.build(1, [stream]);
    const w = new JxlBitWriter();
    code.writeStream(w, stream);
    const actual = w.bitPosition;
    expect(Math.abs(estimateStreamBits(stream, 1) - actual) / actual).toBeLessThan(0.02);
  });

  it('copies overlapping matches and repeated sequences across contexts, resetting between streams', () => {
    const sequence = [0xffffffff, 17, 0, 42, 3, 65535, 8, 1, 19, 600];
    const values = [
      ...Array.from({ length: 12000 }, (_, i) => sequence[i % sequence.length]),
      ...Array.from({ length: 10000 }, () => 7),
    ];
    const streams = [0, 1].map((shift) => ({
      contexts: Uint8Array.from(values, (_, i) => (i + shift) % 3),
      values,
    }));
    const code = JxlEncEntropyCode.buildModular(3, streams);
    const header = new JxlBitWriter();
    code.writeHeader(header);
    expect(new JxlBitReader(header.finish()).readBool()).toBe(true);
    for (const stream of streams) {
      const w = new JxlBitWriter();
      code.writeHeader(w);
      code.writeStream(w, stream);
      w.writeBits(13, 0x1abc);
      expect(w.bitPosition).toBeLessThan(2000);
      const br = new JxlBitReader(w.finish());
      const dec = JxlEntropyDecoder.read(br, 3);
      dec.begin(br);
      for (let i = 0; i < values.length; i++) expect(dec.readUint(br, stream.contexts[i], 64)).toBe(values[i]);
      dec.finish();
      expect(br.readBits(13)).toBe(0x1abc);
    }
    expect(() => code.writeStream(new JxlBitWriter(), { contexts: [], values: [] })).toThrow(/not included/);
  });

  it('retains plain coding when LZ77 headers would cost more than they save', () => {
    const stream = { contexts: new Uint8Array(1000), values: new Uint32Array(1000) };
    const code = JxlEncEntropyCode.buildModular(1, [stream]);
    const w = new JxlBitWriter();
    code.writeHeader(w);
    code.writeStream(w, stream);
    const br = new JxlBitReader(w.finish());
    expect(br.readBool()).toBe(false); // a zero-bit prefix symbol already codes every sample
  });

  it('chooses ANS for a skewed residual distribution when it saves complete coded size', () => {
    let seed = 12345;
    const values = Array.from({ length: 20000 }, () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % 20 ? 0 : (seed >>> 8) & 255;
    });
    const stream = { contexts: new Uint8Array(values.length), values };
    const code = JxlEncEntropyCode.buildModular(1, [stream], true);
    const w = new JxlBitWriter();
    code.writeHeader(w);
    code.writeStream(w, stream);
    const br = new JxlBitReader(w.finish());
    const lz = br.readBool();
    if (lz) {
      br.readU32(224, 512, 4096, { bits: 15, offset: 8 });
      br.readU32(3, 4, { bits: 2, offset: 5 }, { bits: 8, offset: 9 });
      readHybridUintConfig(br, 8);
    }
    readContextMap(br, lz ? 2 : 1);
    expect(br.readBool()).toBe(false); // ANS selected
    const prefix = new JxlBitWriter();
    const prefixCode = JxlEncEntropyCode.build(1, [stream]);
    prefixCode.writeHeader(prefix);
    prefixCode.writeStream(prefix, stream);
    expect(w.bitPosition).toBeLessThan(prefix.bitPosition * 0.7);
  });

  it('cached coded sizes include exact headers, hybrid extras and each stream state', () => {
    for (const values of [[0, 0, 0], Array.from({ length: 2000 }, (_, i) => i % 31), [0xffffffff, 7, 80, 99]]) {
      const streams = [0, 1].map(() => ({ contexts: new Uint8Array(values.length), values }));
      const code = JxlEncEntropyCode.buildModular(1, streams, true);
      const w = new JxlBitWriter();
      code.writeHeader(w);
      for (const stream of streams) code.writeStream(w, stream);
      expect(code.encodedSizeBits).toBe(w.bitPosition);
    }
  });

  it('clusters many logical HF contexts into a small set of prefix histograms', () => {
    const contextMap = Uint8Array.from({ length: 495 }, (_, c) => (c < 37 ? 0 : 1 + (c & 1)));
    const stream = { contexts: [0, 494, 37, 12, 490, 140], values: [63, 0, 0xffffffff, 3, 2, 99] };
    const code = JxlEncEntropyCode.build(495, [stream], contextMap);
    const w = new JxlBitWriter();
    code.writeHeader(w);
    code.writeStream(w, stream);
    w.writeBits(13, 0x1abc);
    const br = new JxlBitReader(w.finish());
    const dec = JxlEntropyDecoder.read(br, 495);
    dec.begin(br);
    for (let i = 0; i < stream.values.length; i++) expect(dec.readUint(br, stream.contexts[i])).toBe(stream.values[i]);
    dec.finish();
    expect(br.readBits(13)).toBe(0x1abc);
  });

  it('buildPrefixCode trims the alphabet to the last used token', () => {
    expect(buildPrefixCode([3, 0, 1, 0, 0]).alphabetSize).toBe(3);
    expect(buildPrefixCode([0, 0]).alphabetSize).toBe(1);
  });
});
