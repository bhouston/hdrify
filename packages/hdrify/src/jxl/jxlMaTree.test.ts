import { describe, expect, it } from 'vitest';
import { JxlBitReader } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import { packSigned } from './jxlEncEntropy.js';
import { type EntropyOp, writeEntropyStream } from './jxlEntropyTestUtils.js';
import { filterTree, type MaTree, readMaTree } from './jxlMaTree.js';
import { decodeModularStream } from './jxlModular.js';
import { Predictor } from './jxlPredictors.js';

type Node = { prop: number; split: number } | { pred: number; offset?: number; mulLog?: number; mulBits?: number };

/** Encode MA tree nodes (breadth-first order, as DecodeTree numbers them) as tree-context ops. */
function treeOps(nodes: Node[]): EntropyOp[] {
  const ops: EntropyOp[] = [];
  for (const n of nodes) {
    if ('prop' in n) {
      ops.push({ ctx: 1, value: n.prop + 1 }, { ctx: 0, value: packSigned(n.split) });
    } else {
      ops.push(
        { ctx: 1, value: 0 },
        { ctx: 2, value: n.pred },
        { ctx: 3, value: packSigned(n.offset ?? 0) },
        { ctx: 4, value: n.mulLog ?? 0 },
        { ctx: 5, value: n.mulBits ?? 0 },
      );
    }
  }
  return ops;
}

function writeTree(w: JxlBitWriter, nodes: Node[], dataOps: EntropyOp[], numLeaves: number): void {
  writeEntropyStream(w, { numDists: 6, usePrefix: false }, treeOps(nodes));
  writeEntropyStream(w, { numDists: numLeaves, usePrefix: false }, dataOps);
}

/** GroupHeader with default WP and no transforms. */
function writeGroupHeader(w: JxlBitWriter, useGlobalTree: boolean): void {
  w.writeBool(useGlobalTree);
  w.writeBool(true); // default WP
  w.writeBits(2, 0); // nb_transforms = 0
}

describe('MA tree filtering', () => {
  it('filterTree resolves channel / stream decisions and reports needs', () => {
    // root: channel (0) > 0 ? [stream (1) > 4 ? leafA : WP-prop split] : leafC
    const t: MaTree = {
      property: Int32Array.from([0, 1, -1, -1, 15, -1, -1]),
      splitVal: Int32Array.from([0, 4, 0, 0, 0, 0, 0]),
      left: Int32Array.from([1, 3, 0, 0, 5, 0, 0]),
      right: Int32Array.from([2, 4, 0, 0, 6, 0, 0]),
      ctx: Int32Array.from([0, 0, 0, 1, 0, 2, 3]),
      predictor: Uint8Array.from([0, 0, 1, 2, 0, 3, 4]),
      offset: Int32Array.from([0, 0, 0, 0, 0, 0, 0]),
      multiplier: Int32Array.from([1, 1, 1, 1, 1, 1, 1]),
      numLeaves: 4,
    };
    const c0 = filterTree(t, 0, 9);
    expect(Array.from(c0.property)).toEqual([-1]);
    expect(c0.ctx[0]).toBe(0);
    expect(c0.usesWp).toBe(false);
    const c1s5 = filterTree(t, 1, 5);
    expect(Array.from(c1s5.property)).toEqual([-1]);
    expect(c1s5.ctx[0]).toBe(1);
    const c1s3 = filterTree(t, 1, 3);
    expect(Array.from(c1s3.property)).toEqual([15, -1, -1]);
    expect(c1s3.usesWp).toBe(true);
    expect(c1s3.numProps).toBe(16);
  });

  it('rounds reference properties up to whole channels', () => {
    const t: MaTree = {
      property: Int32Array.from([17, -1, -1]),
      splitVal: Int32Array.from([0, 0, 0]),
      left: Int32Array.from([1, 0, 0]),
      right: Int32Array.from([2, 0, 0]),
      ctx: Int32Array.from([0, 0, 1]),
      predictor: Uint8Array.from([0, Predictor.Weighted, 0]),
      offset: new Int32Array(3),
      multiplier: Int32Array.from([1, 1, 1]),
      numLeaves: 2,
    };
    const f = filterTree(t, 3, 0);
    expect(f.numProps).toBe(20);
    expect(f.usesWp).toBe(true);
  });
});

describe('readMaTree', () => {
  it('decodes nodes in breadth-first order with leaf contexts, offsets and multipliers', () => {
    const w = new JxlBitWriter();
    const nodes: Node[] = [
      { prop: 6, split: 10 },
      { pred: Predictor.Left, offset: 3 },
      { prop: 3, split: -2 },
      { pred: Predictor.Top },
      { pred: Predictor.Gradient, offset: -1, mulLog: 2, mulBits: 2 },
    ];
    writeTree(w, nodes, [], 3);
    const { tree } = readMaTree(new JxlBitReader(w.finish()));
    expect(Array.from(tree.property)).toEqual([6, -1, 3, -1, -1]);
    expect(Array.from(tree.splitVal)).toEqual([10, 0, -2, 0, 0]);
    expect(Array.from(tree.left)).toEqual([1, 0, 3, 0, 0]);
    expect(Array.from(tree.right)).toEqual([2, 0, 4, 0, 0]);
    expect(Array.from(tree.ctx)).toEqual([0, 0, 0, 1, 2]);
    expect(Array.from(tree.predictor)).toEqual([0, 1, 0, 2, 5]);
    expect(Array.from(tree.offset)).toEqual([0, 3, 0, 0, -1]);
    expect(Array.from(tree.multiplier)).toEqual([1, 1, 1, 1, 12]);
    expect(tree.numLeaves).toBe(3);
  });

  it('rejects unreachable splits (libjxl ValidateTree)', () => {
    const w = new JxlBitWriter();
    // N > 5 ? (N > 3 ? .. : ..) : ..   -- the inner split can never go right.
    writeTree(w, [{ prop: 6, split: 5 }, { prop: 6, split: 3 }, { pred: 0 }, { pred: 0 }, { pred: 0 }], [], 3);
    expect(() => readMaTree(new JxlBitReader(w.finish()))).toThrow(/invalid MA tree/);
  });

  it('rejects invalid predictors', () => {
    const w = new JxlBitWriter();
    writeTree(w, [{ pred: 14 }], [], 1);
    expect(() => readMaTree(new JxlBitReader(w.finish()))).toThrow();
  });
});

describe('decodeModularStream (synthetic streams)', () => {
  it('local tree: x split, offset, multiplier and Left predictor with edge rules', () => {
    // x > 1 ? leaf0 (Zero, offset 5, multiplier 2) : leaf1 (Left)
    const nodes: Node[] = [
      { prop: 3, split: 1 },
      { pred: Predictor.Zero, offset: 5, mulLog: 1 },
      { pred: Predictor.Left },
    ];
    const width = 4;
    const height = 2;
    const residuals = [7, -2, 3, -4, 1, 1, 0, 2];
    const expected: number[] = [];
    const ops: EntropyOp[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const r = residuals[i];
        const leaf = x > 1 ? 0 : 1;
        ops.push({ ctx: leaf, value: packSigned(r) });
        const left = x > 0 ? expected[i - 1] : y > 0 ? expected[i - width] : 0;
        expected.push(leaf === 0 ? r * 2 + 5 : r + left);
      }
    }
    const w = new JxlBitWriter();
    writeGroupHeader(w, false);
    writeTree(w, nodes, ops, 2);
    const img = decodeModularStream(new JxlBitReader(w.finish()), [{ width, height, hshift: 0, vshift: 0 }], {
      streamId: 0,
    });
    expect(Array.from(img.channels[0].data)).toEqual(expected);
  });

  it('global tree: channel and stream-id splits and reference-channel properties', () => {
    // channel > 0 ? (stream > 4 ? [prop 17 (prev channel value) > 2 ? +100 : -100] : Left) : Zero
    const nodes: Node[] = [
      { prop: 0, split: 0 },
      { prop: 1, split: 4 },
      { pred: Predictor.Zero },
      { prop: 17, split: 2 },
      { pred: Predictor.Left },
      { pred: Predictor.Zero, offset: 100 },
      { pred: Predictor.Zero, offset: -100 },
    ];
    const tw = new JxlBitWriter();
    writeEntropyStream(tw, { numDists: 6, usePrefix: false }, treeOps(nodes));
    // Leaf histograms only; symbols follow per stream. Use a prefix code so the stream needs no ANS state.
    writeEntropyStream(
      tw,
      { numDists: 4, usePrefix: true },
      [0, 1, 2, 3].map((ctx) => ({ ctx, value: 0 })),
    );
    const { tree, decoder } = readMaTree(new JxlBitReader(tw.finish()));

    // Prefix codes were built from one 0-symbol per context, so every coded residual must be 0.
    const ch = [
      { width: 3, height: 1, hshift: 0, vshift: 0 },
      { width: 3, height: 1, hshift: 0, vshift: 0 },
      { width: 2, height: 1, hshift: 0, vshift: 0 },
    ];
    const decode = (streamId: number) => {
      const w = new JxlBitWriter();
      writeGroupHeader(w, true);
      w.writeBits(8, 0);
      return decodeModularStream(new JxlBitReader(w.finish()), ch, {
        streamId,
        globalTree: tree,
        globalDecoder: decoder,
      });
    };
    // Channel 0 is all zeros, so channel 1 (prop 17 = 0 <= 2) gets -100; channel 2 has no same-size
    // predecessor, so its reference properties are 0 -> -100 too.
    expect(decode(5).channels.map((c) => Array.from(c.data))).toEqual([
      [0, 0, 0],
      [-100, -100, -100],
      [-100, -100],
    ]);
    // stream 3: Left predictor on zero residuals -> zeros.
    expect(decode(3).channels.map((c) => Array.from(c.data))).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0],
    ]);
  });

  it('reference properties read the previous channel with matching geometry', () => {
    // channel > 0 ? (prop 17 > 2 ? +100 : -100) : Zero with residual = value
    const nodes: Node[] = [
      { prop: 0, split: 0 },
      { prop: 17, split: 2 },
      { pred: Predictor.Zero },
      { pred: Predictor.Zero, offset: 100 },
      { pred: Predictor.Zero, offset: -100 },
    ];
    const ch0 = [1, 3, 5];
    const ops: EntropyOp[] = [
      ...ch0.map((v) => ({ ctx: 0, value: packSigned(v) })),
      ...ch0.map((v) => ({ ctx: v > 2 ? 1 : 2, value: 0 })),
    ];
    const w = new JxlBitWriter();
    writeGroupHeader(w, false);
    writeTree(w, nodes, ops, 3);
    const img = decodeModularStream(
      new JxlBitReader(w.finish()),
      [
        { width: 3, height: 1, hshift: 0, vshift: 0 },
        { width: 3, height: 1, hshift: 0, vshift: 0 },
      ],
      { streamId: 0 },
    );
    expect(img.channels.map((c) => Array.from(c.data))).toEqual([
      [1, 3, 5],
      [-100, 100, 100],
    ]);
  });

  it('empty channel lists, zero-sized channels and maxChanSize', () => {
    // No channels: nothing is read.
    const empty = decodeModularStream(new JxlBitReader(new Uint8Array(0)), [], { streamId: 0 });
    expect(empty.channels).toEqual([]);

    // Only zero-sized / oversized channels: the header is read but no tree or data.
    const w = new JxlBitWriter();
    writeGroupHeader(w, false);
    const br = new JxlBitReader(w.finish());
    const img = decodeModularStream(
      br,
      [
        { width: 0, height: 5, hshift: 0, vshift: 0 },
        { width: 300, height: 2, hshift: 0, vshift: 0 },
      ],
      { streamId: 0, maxChanSize: 256 },
    );
    expect(br.bitPosition).toBe(4);
    expect(img.channels.map((c) => c.data.length)).toEqual([0, 600]);
  });

  it('wraps samples modulo 2^32', () => {
    const w = new JxlBitWriter();
    writeGroupHeader(w, false);
    writeTree(w, [{ pred: Predictor.Zero, offset: 2 ** 30, mulLog: 1 }], [{ ctx: 0, value: packSigned(2 ** 30) }], 1);
    const img = decodeModularStream(new JxlBitReader(w.finish()), [{ width: 1, height: 1, hshift: 0, vshift: 0 }], {
      streamId: 0,
    });
    // 2^30 * 2 + 2^30 = 3 * 2^30 -> -2^30 as int32
    expect(img.channels[0].data[0]).toBe(-(2 ** 30));
  });
});
