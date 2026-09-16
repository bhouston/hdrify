/**
 * DWAA/DWAB channel classification, shared by the encoder and decoder.
 * Matches DwaCompressor_classifyChannels: channels are grouped into lossy-DCT (CSC-grouped
 * RGB or single channel), RLE (e.g. alpha), or UNKNOWN (zlib) schemes based on name suffix
 * and pixel type. RGB triplets sharing a name prefix and sampling are CSC-grouped.
 */

import { FLOAT, HALF, UINT } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';

export type DwaScheme = 'DCT' | 'RLE' | 'UNKNOWN';

interface DwaRule {
  suffix: string;
  scheme: DwaScheme;
  types: number[];
  cscIdx: number;
}

const DEFAULT_RULES: DwaRule[] = [
  { suffix: 'R', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 0 },
  { suffix: 'G', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 1 },
  { suffix: 'B', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 2 },
  { suffix: 'Y', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: -1 },
  { suffix: 'BY', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: -1 },
  { suffix: 'RY', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: -1 },
  { suffix: 'A', scheme: 'RLE', types: [UINT, HALF, FLOAT], cscIdx: -1 },
];

const LEGACY_RULES: DwaRule[] = [
  { suffix: 'r', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 0 },
  { suffix: 'red', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 0 },
  { suffix: 'g', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 1 },
  { suffix: 'grn', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 1 },
  { suffix: 'green', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 1 },
  { suffix: 'b', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 2 },
  { suffix: 'blu', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 2 },
  { suffix: 'blue', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: 2 },
  { suffix: 'y', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: -1 },
  { suffix: 'by', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: -1 },
  { suffix: 'ry', scheme: 'DCT', types: [HALF, FLOAT], cscIdx: -1 },
  { suffix: 'a', scheme: 'RLE', types: [UINT, HALF, FLOAT], cscIdx: -1 },
];

export function findSuffix(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : name;
}

export function classifyChannel(
  name: string,
  pixelType: number,
  legacy: boolean,
): { scheme: DwaScheme; cscIdx: number } {
  const suffix = findSuffix(name);
  const rules = legacy ? LEGACY_RULES : DEFAULT_RULES;
  const matchSuffix = legacy ? suffix.toLowerCase() : suffix;
  for (const rule of rules) {
    if (rule.suffix === matchSuffix && rule.types.includes(pixelType)) {
      return { scheme: rule.scheme, cscIdx: rule.cscIdx };
    }
  }
  return { scheme: 'UNKNOWN', cscIdx: -1 };
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
export function computeDwaChannelGroups(channels: ExrChannel[], legacy: boolean): DwaChannelGroups {
  const classes = channels.map((ch) => classifyChannel(ch.name, ch.pixelType, legacy));

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
