/**
 * Meta-adaptive (MA) context tree (ISO/IEC 18181-1 H.4.2). Port of libjxl
 * lib/jxl/modular/encoding/dec_ma.cc (DecodeTree, ValidateTree) and encoding.cc FilterTree.
 */
import { type JxlBitReader, unpackSigned } from './jxlBitReader.js';
import { JxlEntropyDecoder } from './jxlEntropy.js';
import { NUM_PREDICTORS, Predictor } from './jxlPredictors.js';

/** Number of non-reference properties: channel, stream, y, x, |N|, |W|, N, W, W-prev, grad, W-NW, NW-N, N-NE, N-NN, W-WW, WP max error. */
export const NUM_NONREF_PROPERTIES = 16;
const WP_PROPERTY = 15;

/**
 * An MA tree in flat arrays. For a decision node `property[i] >= 0`: go to `left[i]` when
 * `props[property[i]] > splitVal[i]`, else `right[i]`. Leaves have `property[i] === -1` and carry
 * `ctx` (leaf index = entropy context), `predictor`, `offset` and `multiplier`.
 */
export interface MaTree {
  property: Int32Array;
  splitVal: Int32Array;
  left: Int32Array;
  right: Int32Array;
  ctx: Int32Array;
  predictor: Uint8Array;
  offset: Int32Array;
  multiplier: Int32Array;
  numLeaves: number;
}

// Tree contexts (libjxl ma_common.h).
const SPLIT_VAL_CTX = 0;
const PROPERTY_CTX = 1;
const PREDICTOR_CTX = 2;
const OFFSET_CTX = 3;
const MUL_LOG_CTX = 4;
const MUL_BITS_CTX = 5;

/** Upper bound on tree nodes (libjxl kMaxTreeSize). */
const MAX_TREE_SIZE = 1 << 22;

/**
 * Read an MA tree (its own 6-context entropy stream) followed by the entropy code for the tree's
 * leaf contexts. `sizeLimit` is the node limit (libjxl: 1024 + local samples, capped at 2^20 for a
 * local tree; 2^22 bound for the global tree).
 */
export function readMaTree(br: JxlBitReader, sizeLimit = MAX_TREE_SIZE): { tree: MaTree; decoder: JxlEntropyDecoder } {
  const td = JxlEntropyDecoder.read(br, 6);
  const limit = Math.min(sizeLimit, MAX_TREE_SIZE);
  const property: number[] = [];
  const splitVal: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  const ctx: number[] = [];
  const predictor: number[] = [];
  const offset: number[] = [];
  const multiplier: number[] = [];
  let leafId = 0;
  let toDecode = 1;
  while (toDecode > 0) {
    if (property.length > limit) throw new Error('JXL: MA tree too large');
    toDecode--;
    const prop1 = td.readUint(br, PROPERTY_CTX);
    if (prop1 > 256) throw new Error('JXL: invalid MA tree property');
    if (prop1 === 0) {
      const pred = td.readUint(br, PREDICTOR_CTX);
      if (pred >= NUM_PREDICTORS) throw new Error('JXL: invalid MA tree predictor');
      const off = unpackSigned(td.readUint(br, OFFSET_CTX));
      const mulLog = td.readUint(br, MUL_LOG_CTX);
      if (mulLog >= 31) throw new Error('JXL: invalid MA tree multiplier');
      const mulBits = td.readUint(br, MUL_BITS_CTX);
      if (mulBits >= 2 ** (31 - mulLog) - 1) throw new Error('JXL: invalid MA tree multiplier');
      property.push(-1);
      splitVal.push(0);
      left.push(0);
      right.push(0);
      ctx.push(leafId++);
      predictor.push(pred);
      offset.push(off);
      multiplier.push((mulBits + 1) * 2 ** mulLog);
      continue;
    }
    const n = property.length;
    property.push(prop1 - 1);
    splitVal.push(unpackSigned(td.readUint(br, SPLIT_VAL_CTX)));
    left.push(n + toDecode + 1);
    right.push(n + toDecode + 2);
    ctx.push(0);
    predictor.push(0);
    offset.push(0);
    multiplier.push(1);
    toDecode += 2;
  }
  td.finish();
  const tree: MaTree = {
    property: Int32Array.from(property),
    splitVal: Int32Array.from(splitVal),
    left: Int32Array.from(left),
    right: Int32Array.from(right),
    ctx: Int32Array.from(ctx),
    predictor: Uint8Array.from(predictor),
    offset: Int32Array.from(offset),
    multiplier: Int32Array.from(multiplier),
    numLeaves: leafId,
  };
  validateTree(tree);
  const decoder = JxlEntropyDecoder.read(br, leafId);
  return { tree, decoder };
}

/** Reject trees whose splits are unreachable given ancestor ranges, or too tall (libjxl ValidateTree). */
function validateTree(tree: MaTree): void {
  let numProps = 0;
  for (const p of tree.property) if (p >= numProps) numProps = p + 1;
  const lo = new Float64Array(numProps).fill(-(2 ** 31));
  const hi = new Float64Array(numProps).fill(2 ** 31 - 1);
  // Iterative DFS: stack of [node, phase, savedLo, savedHi].
  const stack: number[][] = [[0, 0, 0, 0]];
  while (stack.length > 0) {
    if (stack.length >= 2048) throw new Error('JXL: MA tree too tall');
    const item = stack[stack.length - 1]!;
    const node = item[0]!;
    const p = tree.property[node]!;
    if (p < 0) {
      stack.pop();
      continue;
    }
    const v = tree.splitVal[node]!;
    if (item[1] === 0) {
      const l = lo[p]!;
      const u = hi[p]!;
      if (l > v || u <= v) throw new Error('JXL: invalid MA tree');
      item[1] = 1;
      item[2] = l;
      item[3] = u;
      lo[p] = v + 1;
      stack.push([tree.left[node]!, 0, 0, 0]);
    } else if (item[1] === 1) {
      item[1] = 2;
      lo[p] = item[2]!;
      hi[p] = v;
      stack.push([tree.right[node]!, 0, 0, 0]);
    } else {
      hi[p] = item[3]!;
      stack.pop();
    }
  }
}

/** A tree specialised to one channel/stream, plus what decoding it requires. */
export interface FilteredMaTree extends MaTree {
  /** Property vector length (≥ 16; reference properties come in groups of 4). */
  numProps: number;
  /** Tree uses the WP property or the WP predictor. */
  usesWp: boolean;
}

/**
 * Specialise the tree for a channel and stream id (libjxl FilterTree): decisions on properties 0
 * (channel) and 1 (stream) are resolved. Returns a remapped flat tree with the same layout as MaTree.
 */
export function filterTree(tree: MaTree, channel: number, streamId: number): FilteredMaTree {
  const property: number[] = [];
  const splitVal: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  const ctx: number[] = [];
  const predictor: number[] = [];
  const offset: number[] = [];
  const multiplier: number[] = [];
  let numProps = 0;
  let usesWp = false;
  const resolve = (n: number): number => {
    for (;;) {
      const p = tree.property[n]!;
      if (p !== 0 && p !== 1) return n;
      n = (p === 0 ? channel : streamId) > tree.splitVal[n]! ? tree.left[n]! : tree.right[n]!;
    }
  };
  // BFS so children are appended after parents; `queue[i]` is the source node of output node i.
  const queue = [resolve(0)];
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i]!;
    const p = tree.property[n]!;
    property.push(p);
    if (p < 0) {
      splitVal.push(0);
      left.push(0);
      right.push(0);
      ctx.push(tree.ctx[n]!);
      predictor.push(tree.predictor[n]!);
      offset.push(tree.offset[n]!);
      multiplier.push(tree.multiplier[n]!);
      if (tree.predictor[n] === Predictor.Weighted) usesWp = true;
      continue;
    }
    if (p === WP_PROPERTY) usesWp = true;
    if (p + 1 > numProps) numProps = p + 1;
    splitVal.push(tree.splitVal[n]!);
    left.push(queue.length);
    queue.push(resolve(tree.left[n]!));
    right.push(queue.length);
    queue.push(resolve(tree.right[n]!));
    ctx.push(0);
    predictor.push(0);
    offset.push(0);
    multiplier.push(1);
  }
  numProps =
    numProps > NUM_NONREF_PROPERTIES
      ? Math.ceil((numProps - NUM_NONREF_PROPERTIES) / 4) * 4 + NUM_NONREF_PROPERTIES
      : NUM_NONREF_PROPERTIES;
  return {
    property: Int32Array.from(property),
    splitVal: Int32Array.from(splitVal),
    left: Int32Array.from(left),
    right: Int32Array.from(right),
    ctx: Int32Array.from(ctx),
    predictor: Uint8Array.from(predictor),
    offset: Int32Array.from(offset),
    multiplier: Int32Array.from(multiplier),
    numLeaves: tree.numLeaves,
    numProps,
    usesWp,
  };
}

/** Walk the tree with the given property vector; returns the leaf node index. */
export function maTreeLookup(tree: MaTree, props: Int32Array): number {
  const property = tree.property;
  const splitVal = tree.splitVal;
  let n = 0;
  let p = property[0]!;
  while (p >= 0) {
    n = props[p]! > splitVal[n]! ? tree.left[n]! : tree.right[n]!;
    p = property[n]!;
  }
  return n;
}
