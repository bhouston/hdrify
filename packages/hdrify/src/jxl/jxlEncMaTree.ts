/** Bounded greedy MA-tree search using standard Modular prediction properties.
 * Training samples and split candidates are deterministic; the caller compares
 * complete coded costs against its existing model before accepting the tree.
 */
import { unpackSigned } from './jxlBitReader.js';
import { hybridUintToken, JXL_ENC_NUM_TOKENS, packSigned, type TokenStream } from './jxlEncEntropy.js';

export interface JxlMaSample {
  context: number;
  properties: Int32Array;
  gradient: number;
  weighted: number;
  left?: number;
  top?: number;
  average?: number;
  select?: number;
}

export type JxlLearnedNode =
  | { property: -1; predictor: 1 | 2 | 3 | 4 | 5 | 6; context: number; offset: number; multiplierToken: number }
  | { property: number; threshold: number; left: JxlLearnedNode; right: JxlLearnedNode };

export interface JxlLearnedModel {
  roots: JxlLearnedNode[];
  usesWp: boolean[];
  numLeaves: number;
  stream: TokenStream;
  leaves: Extract<JxlLearnedNode, { predictor: number }>[];
  tokenValues: number[];
}

const PROPERTIES = [4, 5, 9, 10, 11, 12, 13, 14, 15];
const MAX_DEPTH = 6;
const MIN_SAMPLES = 128;

const PREDICTORS = [
  [1, 'left'],
  [2, 'top'],
  [3, 'average'],
  [4, 'select'],
  [5, 'gradient'],
  [6, 'weighted'],
] as const;

function leafCost(samples: JxlMaSample[]): { bits: number; predictor: 1 | 2 | 3 | 4 | 5 | 6 } {
  const hist = PREDICTORS.map(() => new Uint32Array(JXL_ENC_NUM_TOKENS));
  const costs = new Float64Array(PREDICTORS.length);
  for (const sample of samples) {
    for (let p = 0; p < PREDICTORS.length; p++) {
      const value = sample[PREDICTORS[p]![1]];
      if (value === undefined) {
        costs[p] = Infinity;
        continue;
      }
      hist[p]![hybridUintToken(value)]!++;
      if (value >= 16) costs[p]! += 30 - Math.clz32(value);
    }
  }
  let best = 4;
  for (let p = 0; p < PREDICTORS.length; p++) {
    for (const count of hist[p]!) if (count) costs[p]! -= count * Math.log2(count / samples.length);
  }
  for (let p = 0; p < PREDICTORS.length; p++) if (costs[p]! < costs[best]!) best = p;
  return { bits: costs[best]!, predictor: PREDICTORS[best]![0] };
}

function learn(samples: JxlMaSample[], depth: number): JxlLearnedNode {
  const cost = leafCost(samples);
  const leaf: JxlLearnedNode = { property: -1, predictor: cost.predictor, context: -1, offset: 0, multiplierToken: -1 };
  if (!depth || samples.length < MIN_SAMPLES * 2 || cost.bits < 16) return leaf;
  let best: { property: number; threshold: number; left: JxlMaSample[]; right: JxlMaSample[] } | undefined;
  let bestBits = cost.bits - 16; // discourage splits with little evidence of a gain
  for (const property of PROPERTIES) {
    const values = samples.map((s) => s.properties[property]!).toSorted((a, b) => a - b);
    let previous: number | undefined;
    for (const q of [0.25, 0.5, 0.75]) {
      const threshold = values[Math.floor((values.length - 1) * q)]!;
      if (threshold === previous) continue;
      previous = threshold;
      const left: JxlMaSample[] = [],
        right: JxlMaSample[] = [];
      for (const sample of samples) (sample.properties[property]! > threshold ? left : right).push(sample);
      if (left.length < MIN_SAMPLES || right.length < MIN_SAMPLES) continue;
      const bits = leafCost(left).bits + leafCost(right).bits;
      if (bits < bestBits) {
        bestBits = bits;
        best = { property, threshold, left, right };
      }
    }
  }
  if (!best) return leaf;
  return {
    property: best.property,
    threshold: best.threshold,
    left: learn(best.left, depth - 1),
    right: learn(best.right, depth - 1),
  };
}

function isLeaf(node: JxlLearnedNode): node is Extract<JxlLearnedNode, { predictor: number }> {
  return 'predictor' in node;
}

function usesWp(node: JxlLearnedNode): boolean {
  return isLeaf(node) ? node.predictor === 6 : node.property === 15 || usesWp(node.left) || usesWp(node.right);
}

/** Compile a tree with property-0 channel splits followed by learned spatial splits.
 * At most 64 leaves per input context, with a 255-leaf total cap to reserve
 * one entropy context for LZ77 distances within the 256-cluster limit.
 */
export function learnMaTree(samples: JxlMaSample[], channelContext: number[]): JxlLearnedModel | undefined {
  const grouped = Array.from({ length: channelContext.length }, () => [] as JxlMaSample[]);
  for (const sample of samples) grouped[sample.context]!.push(sample);
  const maxDepth = Math.min(MAX_DEPTH, Math.floor(Math.log2(Math.floor(255 / channelContext.length))));
  const roots = grouped.map((group) => learn(group, maxDepth));
  if (roots.every(isLeaf)) return undefined;
  const residuals = new Map<Extract<JxlLearnedNode, { predictor: number }>, number[]>();
  for (const sample of samples) {
    const leaf = learnedLeaf(roots[sample.context]!, sample.properties);
    const value = sample[PREDICTORS.find(([predictor]) => predictor === leaf.predictor)![1]];
    if (value === undefined) continue;
    let list = residuals.get(leaf);
    if (!list) {
      list = [];
      residuals.set(leaf, list);
    }
    list.push(unpackSigned(value));
  }
  const costOffset = (values: number[], offset: number): number => {
    const hist = new Uint32Array(JXL_ENC_NUM_TOKENS);
    let bits = 0;
    for (const value of values) {
      const v = packSigned((value - offset) | 0);
      hist[hybridUintToken(v)]!++;
      if (v >= 16) bits += 30 - Math.clz32(v);
    }
    for (const count of hist) if (count) bits -= count * Math.log2(count / values.length);
    return bits;
  };
  for (const [leaf, values] of residuals) {
    const median = values.toSorted((a, b) => a - b)[values.length >> 1]!;
    if (median && costOffset(values, median) + 8 < costOffset(values, 0)) leaf.offset = median;
  }
  const channels = (lo: number, hi: number): JxlLearnedNode => {
    if (lo === hi) return roots[channelContext[lo]!]!;
    const mid = (lo + hi) >> 1;
    return { property: 0, threshold: mid, left: channels(mid + 1, hi), right: channels(lo, mid) };
  };
  const queue = [channels(0, channelContext.length - 1)];
  const contexts: number[] = [],
    values: number[] = [];
  const push = (ctx: number, value: number): void => {
    contexts.push(ctx);
    values.push(value);
  };
  let numLeaves = 0;
  const leaves: Extract<JxlLearnedNode, { predictor: number }>[] = [];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]!;
    if (isLeaf(node)) {
      node.context = numLeaves++;
      push(1, 0);
      push(2, node.predictor);
      push(3, packSigned(node.offset));
      node.multiplierToken = values.length;
      leaves.push(node);
      push(4, 0);
      push(5, 0);
    } else {
      push(1, node.property + 1);
      push(0, packSigned(node.threshold));
      queue.push(node.left, node.right);
    }
  }
  return { roots, usesWp: roots.map(usesWp), numLeaves, stream: { contexts, values }, leaves, tokenValues: values };
}

export function learnedLeaf(
  root: JxlLearnedNode,
  properties: Int32Array,
): Extract<JxlLearnedNode, { predictor: number }> {
  let node = root;
  while (!isLeaf(node)) node = properties[node.property]! > node.threshold ? node.left : node.right;
  return node;
}

/** Factor only powers of two proven common to every full-stream residual in a leaf.
 * Sampling never decides divisibility. This preserves all int32 wrap-around cases.
 */
export function factorMaResiduals(model: JxlLearnedModel, streams: TokenStream[]): TokenStream[] {
  const common = new Int32Array(model.numLeaves);
  for (const stream of streams)
    for (let i = 0; i < stream.values.length; i++) {
      common[stream.contexts[i]!]! |= unpackSigned(stream.values[i]!);
    }
  const logs = Int32Array.from(common, (bits) => (bits ? Math.min(30, 31 - Math.clz32((bits & -bits) >>> 0)) : 0));
  for (let c = 0; c < logs.length; c++) model.tokenValues[model.leaves[c]!.multiplierToken] = logs[c]!;
  if (logs.every((log) => log === 0)) return streams;
  return streams.map((stream) => ({
    contexts: stream.contexts,
    values: Float64Array.from(stream.values, (value, i) =>
      packSigned(unpackSigned(value) / 2 ** logs[stream.contexts[i]!]!),
    ),
  }));
}
