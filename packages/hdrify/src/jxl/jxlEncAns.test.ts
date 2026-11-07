import { describe, expect, it } from 'vitest';
import { JxlBitReader } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import { JxlAnsCode, normalizeCounts } from './jxlEncAns.js';
import { hybridUintToken, type TokenStream } from './jxlEncEntropy.js';
import { JxlEntropyDecoder } from './jxlEntropy.js';

function roundTrip(streams: TokenStream[], histograms?: Uint32Array[]): void {
  const hist = histograms ?? Array.from({ length: 3 }, () => new Uint32Array(256));
  if (!histograms)
    for (const stream of streams)
      for (let i = 0; i < stream.values.length; i++) {
        hist[stream.contexts[i]][hybridUintToken(stream.values[i])]++;
      }
  const code = new JxlAnsCode(hist);
  for (const stream of streams) {
    const w = new JxlBitWriter();
    w.writeBool(false); // no LZ77
    w.writeBool(true);
    w.writeBits(2, 2); // simple context map
    for (let c = 0; c < 3; c++) w.writeBits(2, c);
    w.writeBool(false);
    w.writeBits(2, 3); // ANS, log alphabet size 8
    for (let c = 0; c < 3; c++) {
      w.writeBits(4, 4);
      w.writeBits(3, 1);
      w.writeBits(2, 0); // hybrid uint (4,1,0)
    }
    code.writeHistograms(w);
    code.writeStream(w, stream);
    w.writeBits(13, 0x1abc);
    const br = new JxlBitReader(w.finish());
    const decoder = JxlEntropyDecoder.read(br, 3);
    decoder.begin(br);
    for (let i = 0; i < stream.values.length; i++)
      expect(decoder.readUint(br, stream.contexts[i])).toBe(stream.values[i]);
    decoder.finish();
    expect(br.readBits(13)).toBe(0x1abc);
  }
}

describe('alias-ANS encoder', () => {
  it('normalizes skewed alphabets without losing rare symbols or underflowing counts', () => {
    for (const histogram of [
      Array.from({ length: 256 }, (_, i) => (i < 100 ? 1000000 : 1)),
      [1e12, ...Array.from({ length: 255 }, () => 1)],
      Array.from({ length: 256 }, (_, i) => (i * 31) % 49),
      [0, 0, 0],
    ]) {
      const counts = normalizeCounts(histogram);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(4096);
      for (let i = 0; i < histogram.length; i++) if (histogram[i]) expect(counts[i]).toBeGreaterThan(0);
    }
    expect(() => normalizeCounts(new Uint8Array(257))).toThrow(/alphabet/);
  });

  it('handles empty, single-symbol, two-symbol and skewed contexts and fresh stream states', () => {
    roundTrip([
      { contexts: [], values: [] },
      { contexts: [0, 0, 1, 1, 1], values: [42, 42, 0, 1, 1] },
      { contexts: [1, 0, 1], values: [1, 42, 0] },
    ]);
    const hist = Array.from({ length: 3 }, () => Uint32Array.from({ length: 256 }, (_, i) => (i < 100 ? 1000000 : 1)));
    roundTrip([{ contexts: [0, 1, 2, 1], values: [0, 1, 15, 0xffffffff] }], hist);
  });

  it('round-trips random uint32 values, renormalization and hybrid extra bits', () => {
    let seed = 123456;
    const values = Array.from({ length: 10000 }, (_, i) => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return i % 3 ? (seed >>> 0) % 100 : seed >>> 0;
    });
    values[0] = 0xffffffff;
    const contexts = Uint8Array.from(values, (_, i) => i % 3);
    roundTrip([
      { contexts, values },
      { contexts, values: values.toReversed() },
    ]);
  });

  it('encodes ANS LZ77 length symbols and overlapping copies with a 256-symbol alphabet', () => {
    const values = [2, 997, 120, 1, 1997, 120];
    const contexts = [0, 0, 1, 0, 0, 1];
    const offsets = [0, 128, 0, 0, 128, 0];
    const hist = [new Uint32Array(256), new Uint32Array(256)];
    for (let i = 0; i < values.length; i++) hist[contexts[i]][hybridUintToken(values[i]) + offsets[i]]++;
    const code = new JxlAnsCode(hist);
    const w = new JxlBitWriter();
    w.writeBool(true); // LZ77
    w.writeU32(128, 224, 512, 4096, { bits: 15, offset: 8 });
    w.writeU32(3, 3, 4, { bits: 2, offset: 5 }, { bits: 8, offset: 9 });
    w.writeBits(4, 4);
    w.writeBits(3, 1);
    w.writeBits(2, 0); // length config
    w.writeBool(true);
    w.writeBits(2, 1);
    w.writeBits(1, 0);
    w.writeBits(1, 1); // two contexts
    w.writeBool(false);
    w.writeBits(2, 3); // ANS
    for (let c = 0; c < 2; c++) {
      w.writeBits(4, 4);
      w.writeBits(3, 1);
      w.writeBits(2, 0);
    }
    code.writeHistograms(w);
    code.writeStream(w, { contexts, values }, offsets);
    w.writeBits(13, 0x1abc);
    const br = new JxlBitReader(w.finish());
    const dec = JxlEntropyDecoder.read(br, 1);
    dec.begin(br);
    for (let i = 0; i < 1001; i++) expect(dec.readUint(br, 0, 64)).toBe(2);
    for (let i = 0; i < 2001; i++) expect(dec.readUint(br, 0, 64)).toBe(1);
    dec.finish();
    expect(br.readBits(13)).toBe(0x1abc);
  });

  it('rejects symbols absent from its histogram', () => {
    expect(() =>
      new JxlAnsCode([new Uint32Array(256)]).writeStream(new JxlBitWriter(), { contexts: [0], values: [1] }),
    ).toThrow(/absent/);
  });
});
