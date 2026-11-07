import { describe, expect, it } from 'vitest';
import { JxlBitReader, unpackSigned } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import { JxlEncEntropyCode, packSigned } from './jxlEncEntropy.js';
import { factorMaResiduals, learnMaTree, learnedLeaf, type JxlMaSample } from './jxlEncMaTree.js';
import { readMaTree } from './jxlMaTree.js';

function samples(context = 0, extreme = false): JxlMaSample[] {
  return Array.from({ length: 2048 }, (_, i) => {
    const properties = new Int32Array(16);
    const side = i & 1;
    properties[5] = extreme ? (side ? 0x7fffffff : -0x80000000) : side ? 100 : -100;
    return {
      context,
      properties,
      gradient: side ? packSigned((i % 91) - 45) : 0,
      weighted: side ? 0 : packSigned((i % 91) - 45),
    };
  });
}

function depth(node: NonNullable<ReturnType<typeof learnMaTree>>['roots'][number]): number {
  return 'predictor' in node ? 0 : 1 + Math.max(depth(node.left), depth(node.right));
}

describe('learned Modular trees', () => {
  it('learns a signed property split and chooses different predictors on each side', () => {
    const input = samples();
    const model = learnMaTree(input, [0])!;
    expect(model.numLeaves).toBe(2);
    expect(model.usesWp).toEqual([true]);
    for (const sample of input) {
      const leaf = learnedLeaf(model.roots[0], sample.properties);
      expect(leaf.predictor).toBe(sample.properties[5] > 0 ? 6 : 5);
    }
    expect(learnMaTree(input, [0])!.stream).toEqual(model.stream);
  });

  it('serializes valid breadth-first trees, channel remapping and full int32 thresholds', () => {
    const model = learnMaTree([...samples(0, true), ...samples(1)], [1, 0])!;
    const w = new JxlBitWriter();
    const treeCode = JxlEncEntropyCode.build(6, [model.stream]);
    treeCode.writeHeader(w);
    treeCode.writeStream(w, model.stream);
    JxlEncEntropyCode.build(model.numLeaves, []).writeHeader(w);
    const decoded = readMaTree(new JxlBitReader(w.finish())).tree;
    expect(decoded.numLeaves).toBe(model.numLeaves);
    for (const [channel, context] of [
      [0, 1],
      [1, 0],
    ]) {
      for (const sample of samples(context, context === 0)) {
        let node = 0;
        const props = sample.properties.slice();
        props[0] = channel!;
        while (decoded.property[node] >= 0) {
          node = props[decoded.property[node]] > decoded.splitVal[node] ? decoded.left[node] : decoded.right[node];
        }
        const leaf = learnedLeaf(model.roots[context], props);
        expect(decoded.ctx[node]).toBe(leaf.context);
        expect(decoded.predictor[node]).toBe(leaf.predictor);
      }
    }
  });

  it('can choose a cheap directional predictor without requiring weighted state', () => {
    const input = samples().map((sample) => ({
      ...sample,
      left: 0,
      top: 0xffffffff,
      average: 7,
      select: 0xffffffff,
      gradient: 31,
      weighted: 63,
    }));
    // One half prefers Left and the other Average, so a split is useful.
    for (let i = 0; i < input.length; i++)
      if (i & 1) {
        input[i].left = 31;
        input[i].average = 0;
      }
    const model = learnMaTree(input, [0])!;
    expect(model.usesWp).toEqual([false]);
    expect(learnedLeaf(model.roots[0], input[0].properties).predictor).toBe(1);
    expect(learnedLeaf(model.roots[0], input[1].properties).predictor).toBe(3);
  });

  it('learns residual offsets and serializes them with the chosen predictor', () => {
    const input = samples().map((sample) => ({
      ...sample,
      gradient: packSigned(sample.properties[5] > 0 ? 128 : 64),
      weighted: packSigned(sample.properties[5] > 0 ? 128 : 64),
    }));
    const model = learnMaTree(input, [0])!;
    expect(learnedLeaf(model.roots[0], input[0].properties).offset).toBe(64);
    expect(learnedLeaf(model.roots[0], input[1].properties).offset).toBe(128);
  });

  it('factors only full-stream divisibility and preserves signed wraparound', () => {
    const model = learnMaTree(samples(), [0])!;
    const context = learnedLeaf(model.roots[0], samples()[0].properties).context;
    const original = [8, -16, -2147483648];
    const streams = [{ contexts: [context, context, context], values: original.map(packSigned) }];
    const factored = factorMaResiduals(model, streams);
    const log = model.tokenValues[model.leaves[context].multiplierToken];
    expect(log).toBe(3);
    for (let i = 0; i < original.length; i++) {
      expect(Math.imul(unpackSigned(factored[0].values[i]), 2 ** log)).toBe(original[i]);
    }
    const withOddValue = [{ contexts: [context, context], values: [packSigned(8), packSigned(7)] }];
    expect(factorMaResiduals(model, withOddValue)).toBe(withOddValue);
    expect(model.tokenValues[model.leaves[context].multiplierToken]).toBe(0);
  });

  it('bounds tree depth and rejects unsupported splits on constant/small samples', () => {
    expect(learnMaTree([], [0])).toBeUndefined();
    expect(learnMaTree(samples().slice(0, 64), [0])).toBeUndefined();
    const constant = samples().map((sample) => ({ ...sample, gradient: 0, weighted: 0 }));
    expect(learnMaTree(constant, [0])).toBeUndefined();
    const model = learnMaTree(samples(), [0])!;
    expect(depth(model.roots[0])).toBeLessThanOrEqual(6);
    expect(model.numLeaves).toBeLessThanOrEqual(64);
  });
});
