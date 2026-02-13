// biome-ignore-all lint/security/noSecrets: EXR attribute names (displayWindow, pixelAspectRatio, etc.) are spec strings, not secrets
/**
 * EXR header builder for writing
 * Builds header bytes from options. Output parses correctly via parseExrHeader.
 */

import type { Chromaticities } from '../color/chromaticities.js';
import { EXR_MAGIC, FLOAT, FLOAT32_SIZE, INT32_SIZE, NO_COMPRESSION } from './exrConstants.js';
import type { ExrChannel } from './exrTypes.js';
import { concatUint8Arrays } from './exrUtils.js';

export interface WriteExrHeaderOptions {
  width?: number;
  height?: number;
  compression?: number;
  channels?: Array<{ name: string; pixelType?: number; xSampling?: number; ySampling?: number }>;
  /** Chromaticities to write (8 floats: redX, redY, greenX, greenY, blueX, blueY, whiteX, whiteY) */
  chromaticities?: Chromaticities;
  /** Extra attributes to add before channels (e.g. for testing unknown attribute skip) */
  extraAttributes?: Array<{ name: string; type: string; value: Uint8Array }>;
  /** Attributes to omit (e.g. for testing required attributes) */
  omitAttributes?: string[];
}

const DEFAULT_CHANNELS: ExrChannel[] = [
  { name: 'R', pixelType: FLOAT, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'G', pixelType: FLOAT, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'B', pixelType: FLOAT, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
  { name: 'A', pixelType: FLOAT, pLinear: 0, reserved: 0, xSampling: 1, ySampling: 1 },
];

function addAttribute(parts: Uint8Array[], name: string, type: string, value: Uint8Array): void {
  parts.push(new TextEncoder().encode(`${name}\0`));
  parts.push(new TextEncoder().encode(`${type}\0`));
  const size = new Uint8Array(INT32_SIZE);
  new DataView(size.buffer).setUint32(0, value.length, true);
  parts.push(size);
  parts.push(value);
}

/**
 * Build magic number and version field (8 bytes).
 * For single-part scanline files, version is 2.
 */
export function buildMagicAndVersion(options?: { magic?: number; version?: number }): Uint8Array {
  const magic = options?.magic ?? EXR_MAGIC;
  const version = options?.version ?? 2;
  const result = new Uint8Array(8);
  const dv = new DataView(result.buffer);
  dv.setUint32(0, magic, true);
  dv.setUint32(4, version, true);
  return result;
}

/**
 * Build EXR header attributes (without magic/version).
 * Does not include the null terminator for single-part (per OpenEXR spec: omitted for single-part).
 */
export function buildExrHeader(options: WriteExrHeaderOptions = {}): Uint8Array {
  const {
    width = 10,
    height = 10,
    compression = NO_COMPRESSION,
    channels = [{ name: 'R', pixelType: FLOAT }, { name: 'G' }, { name: 'B' }, { name: 'A' }],
    extraAttributes = [],
    omitAttributes = [],
  } = options;

  const parts: Uint8Array[] = [];

  const addIfNotOmitted = (name: string, fn: () => void) => {
    if (!omitAttributes.includes(name)) fn();
  };

  // displayWindow (box2i)
  addIfNotOmitted('displayWindow', () => {
    const val = new Uint8Array(16);
    const dv = new DataView(val.buffer);
    dv.setInt32(0, 0, true);
    dv.setInt32(4, 0, true);
    dv.setInt32(8, width - 1, true);
    dv.setInt32(12, height - 1, true);
    addAttribute(parts, 'displayWindow', 'box2i', val);
  });

  // dataWindow (box2i)
  addIfNotOmitted('dataWindow', () => {
    const val = new Uint8Array(16);
    const dv = new DataView(val.buffer);
    dv.setInt32(0, 0, true);
    dv.setInt32(4, 0, true);
    dv.setInt32(8, width - 1, true);
    dv.setInt32(12, height - 1, true);
    addAttribute(parts, 'dataWindow', 'box2i', val);
  });

  // lineOrder
  addIfNotOmitted('lineOrder', () => {
    addAttribute(parts, 'lineOrder', 'lineOrder', new Uint8Array([0]));
  });

  // pixelAspectRatio
  addIfNotOmitted('pixelAspectRatio', () => {
    const val = new Uint8Array(4);
    new DataView(val.buffer).setFloat32(0, 1.0, true);
    addAttribute(parts, 'pixelAspectRatio', 'float', val);
  });

  // screenWindowCenter
  addIfNotOmitted('screenWindowCenter', () => {
    const val = new Uint8Array(8);
    new DataView(val.buffer).setFloat32(0, 0, true);
    new DataView(val.buffer).setFloat32(4, 0, true);
    addAttribute(parts, 'screenWindowCenter', 'v2f', val);
  });

  // screenWindowWidth
  addIfNotOmitted('screenWindowWidth', () => {
    const val = new Uint8Array(4);
    new DataView(val.buffer).setFloat32(0, 1.0, true);
    addAttribute(parts, 'screenWindowWidth', 'float', val);
  });

  // compression
  addIfNotOmitted('compression', () => {
    addAttribute(parts, 'compression', 'compression', new Uint8Array([compression]));
  });

  // chromaticities (optional)
  const chromaticities = options.chromaticities;
  if (chromaticities && !omitAttributes.includes('chromaticities')) {
    const val = new Uint8Array(8 * FLOAT32_SIZE);
    const dv = new DataView(val.buffer);
    let o = 0;
    dv.setFloat32(o, chromaticities.redX, true);
    o += FLOAT32_SIZE;
    dv.setFloat32(o, chromaticities.redY, true);
    o += FLOAT32_SIZE;
    dv.setFloat32(o, chromaticities.greenX, true);
    o += FLOAT32_SIZE;
    dv.setFloat32(o, chromaticities.greenY, true);
    o += FLOAT32_SIZE;
    dv.setFloat32(o, chromaticities.blueX, true);
    o += FLOAT32_SIZE;
    dv.setFloat32(o, chromaticities.blueY, true);
    o += FLOAT32_SIZE;
    dv.setFloat32(o, chromaticities.whiteX, true);
    o += FLOAT32_SIZE;
    dv.setFloat32(o, chromaticities.whiteY, true);
    addAttribute(parts, 'chromaticities', 'chromaticities', val);
  }

  // Extra attributes (e.g. for unknown skip, string attribute)
  for (const attr of extraAttributes) {
    addAttribute(parts, attr.name, attr.type, attr.value);
  }

  // channels (chlist)
  addIfNotOmitted('channels', () => {
    const chlistParts: Uint8Array[] = [];
    for (const ch of channels) {
      const pt = ch.pixelType ?? FLOAT;
      const xs = ch.xSampling ?? 1;
      const ys = ch.ySampling ?? 1;
      chlistParts.push(new TextEncoder().encode(`${ch.name}\0`));
      const chData = new Uint8Array(16);
      const chDv = new DataView(chData.buffer);
      chDv.setInt32(0, pt, true);
      chDv.setUint8(4, 0); // pLinear
      chDv.setInt32(8, xs, true);
      chDv.setInt32(12, ys, true);
      chlistParts.push(chData);
    }
    chlistParts.push(new Uint8Array([0])); // chlist terminator
    const chlistValue = concatUint8Arrays(chlistParts);
    addAttribute(parts, 'channels', 'chlist', chlistValue);
  });

  // End of header: single-part omits null per OpenEXR spec
  parts.push(new Uint8Array([0]));

  return concatUint8Arrays(parts);
}

/**
 * Build a complete EXR header buffer (magic + version + attributes) for parsing tests.
 * parseExrHeader can parse the result.
 */
export function buildExrHeaderForParsing(
  options: Partial<WriteExrHeaderOptions> & { magic?: number; version?: number } = {},
): Uint8Array {
  const { magic, version, ...headerOptions } = options;
  const magicVersion = buildMagicAndVersion({ magic, version });
  const header = buildExrHeader(headerOptions);
  return concatUint8Arrays([magicVersion, header]);
}

export { DEFAULT_CHANNELS };
