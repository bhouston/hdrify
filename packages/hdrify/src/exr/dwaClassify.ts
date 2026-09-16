/**
 * DWAA/DWAB channel classification, shared by the encoder and decoder.
 * Matches DwaCompressor_classifyChannels: channels are grouped into lossy-DCT (CSC-grouped
 * RGB or single channel), RLE (e.g. alpha), or UNKNOWN (zlib) schemes based on name suffix
 * and pixel type. RGB triplets sharing a name prefix and sampling are CSC-grouped.
 *
 * Since DWA v2 the rules are stored in every chunk (see serializeDwaRules/parseDwaRules,
 * mirroring Classifier_write/Classifier_read in internal_dwa_classifier.h); v0/v1 chunks
 * use the built-in case-insensitive legacy rules.
 */

import { FLOAT, HALF, UINT } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';

export type DwaScheme = 'DCT' | 'RLE' | 'UNKNOWN';

/** Wire encoding of DwaScheme (CompressorScheme enum: UNKNOWN=0, LOSSY_DCT=1, RLE=2). */
const SCHEME_CODES: DwaScheme[] = ['UNKNOWN', 'DCT', 'RLE'];

export interface DwaRule {
  suffix: string;
  scheme: DwaScheme;
  types: number[];
  cscIdx: number;
  caseInsensitive: boolean;
}

export const DEFAULT_RULES: DwaRule[] = [
  { suffix: 'R', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 0, caseInsensitive: false },
  { suffix: 'G', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 1, caseInsensitive: false },
  { suffix: 'B', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 2, caseInsensitive: false },
  { suffix: 'Y', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: -1, caseInsensitive: false },
  { suffix: 'BY', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: -1, caseInsensitive: false },
  { suffix: 'RY', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: -1, caseInsensitive: false },
  { suffix: 'A', scheme: 'RLE', types: [UINT, HALF, FLOAT], cscIdx: -1, caseInsensitive: false },
];

export const LEGACY_RULES: DwaRule[] = [
  { suffix: 'r', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 0, caseInsensitive: true },
  { suffix: 'red', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 0, caseInsensitive: true },
  { suffix: 'g', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 1, caseInsensitive: true },
  { suffix: 'grn', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 1, caseInsensitive: true },
  { suffix: 'green', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 1, caseInsensitive: true },
  { suffix: 'b', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 2, caseInsensitive: true },
  { suffix: 'blu', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 2, caseInsensitive: true },
  { suffix: 'blue', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 2, caseInsensitive: true },
  { suffix: 'y', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: -1, caseInsensitive: true },
  { suffix: 'by', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: -1, caseInsensitive: true },
  { suffix: 'ry', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: -1, caseInsensitive: true },
  { suffix: 'a', scheme: 'RLE', types: [UINT, HALF, FLOAT], cscIdx: -1, caseInsensitive: true },
];

export function findSuffix(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : name;
}

function ruleMatches(rule: DwaRule, suffix: string, pixelType: number): boolean {
  if (!rule.types.includes(pixelType)) return false;
  return rule.caseInsensitive ? rule.suffix.toLowerCase() === suffix.toLowerCase() : rule.suffix === suffix;
}

export function classifyChannel(
  name: string,
  pixelType: number,
  rules: DwaRule[],
): { scheme: DwaScheme; cscIdx: number } {
  const suffix = findSuffix(name);
  for (const rule of rules) {
    if (ruleMatches(rule, suffix, pixelType)) return { scheme: rule.scheme, cscIdx: rule.cscIdx };
  }
  return { scheme: 'UNKNOWN', cscIdx: -1 };
}

/**
 * Serialize the rules that apply to `channels` as a DWA v2 chunk rule block: uint16 total
 * size (including itself), then per rule: NUL-terminated suffix, flags byte, pixel type byte.
 * Mirrors DwaCompressor_writeRelevantChannelRules (one entry per suffix+type actually used).
 */
export function serializeDwaRules(channels: ExrChannel[], rules: DwaRule[] = DEFAULT_RULES): Uint8Array {
  const bytes: number[] = [0, 0];
  for (const rule of rules) {
    for (const type of rule.types) {
      const single = { ...rule, types: [type] };
      if (!channels.some((ch) => ruleMatches(single, findSuffix(ch.name), ch.pixelType))) continue;
      bytes.push(...new TextEncoder().encode(rule.suffix), 0);
      bytes.push(
        (((rule.cscIdx + 1) & 15) << 4) | (SCHEME_CODES.indexOf(rule.scheme) << 2) | (rule.caseInsensitive ? 1 : 0),
        type,
      );
    }
  }
  const out = new Uint8Array(bytes);
  new DataView(out.buffer).setUint16(0, out.length, true);
  return out;
}

/** Parse a DWA v2 rule block (see serializeDwaRules). Returns the rules and the block's byte size. */
export function parseDwaRules(data: Uint8Array): { rules: DwaRule[]; size: number } {
  if (data.length < 2) throw new Error('DWA: truncated channel rule block');
  const size = data[0]! | (data[1]! << 8);
  if (size < 2 || size > data.length) throw new Error('DWA: invalid channel rule size');
  const rules: DwaRule[] = [];
  let p = 2;
  while (p < size) {
    const end = data.indexOf(0, p);
    if (end < 0 || end + 2 >= size) throw new Error('DWA: corrupt channel rule');
    const flags = data[end + 1]!;
    const type = data[end + 2]!;
    const cscIdx = (flags >> 4) - 1;
    const scheme = SCHEME_CODES[(flags >> 2) & 3];
    if (!scheme || cscIdx < -1 || cscIdx > 2 || type > FLOAT) throw new Error('DWA: corrupt channel rule');
    rules.push({
      suffix: new TextDecoder().decode(data.subarray(p, end)),
      scheme,
      types: [type],
      cscIdx,
      caseInsensitive: (flags & 1) === 1,
    });
    p = end + 3;
  }
  return { rules, size };
}

export interface DwaChannelGroups {
  classes: { scheme: DwaScheme; cscIdx: number }[];
  /** [r,g,b] channel indices for each CSC-groupable RGB triplet. */
  cscGroups: [number, number, number][];
  /** Channel indices consumed by a CSC group (excluded from further per-channel handling). */
  grouped: Set<number>;
}

/**
 * Classify all channels and find CSC-groupable RGB triplets: same name prefix, all three
 * present, DCT-classified with cscIdx 0/1/2, and matching x/y sampling.
 */
export function computeDwaChannelGroups(channels: ExrChannel[], rules: DwaRule[]): DwaChannelGroups {
  const classes = channels.map((ch) => classifyChannel(ch.name, ch.pixelType, rules));

  const prefixMap = new Map<string, [number, number, number]>();
  for (let i = 0; i < channels.length; i++) {
    const cls = classes[i]!;
    if (cls.scheme !== 'DCT' || cls.cscIdx < 0) continue;
    const channel = channels[i]!;
    const suffix = findSuffix(channel.name);
    const prefix = channel.name.slice(0, channel.name.length - suffix.length);
    let entry = prefixMap.get(prefix);
    if (!entry) {
      entry = [-1, -1, -1];
      prefixMap.set(prefix, entry);
    }
    entry[cls.cscIdx] = i;
  }

  const cscGroups: [number, number, number][] = [];
  const grouped = new Set<number>();
  for (const [r, g, b] of prefixMap.values()) {
    if (r < 0 || g < 0 || b < 0) continue;
    const rc = channels[r]!;
    const gc = channels[g]!;
    const bc = channels[b]!;
    if (
      rc.xSampling === gc.xSampling &&
      rc.xSampling === bc.xSampling &&
      rc.ySampling === gc.ySampling &&
      rc.ySampling === bc.ySampling
    ) {
      cscGroups.push([r, g, b]);
      grouped.add(r);
      grouped.add(g);
      grouped.add(b);
    }
  }

  return { classes, cscGroups, grouped };
}
