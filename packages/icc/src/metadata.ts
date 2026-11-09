import { readIccProfile, type IccProfile } from './index.js';
import { readIccTagValue } from './tags.js';

export type IccVersion = '2.0' | '2.1' | '2.4' | '4.0' | '4.2' | '4.3' | '4.4';
export type IccIntent = 'Perceptual' | 'Relative' | 'Saturation' | 'Absolute';
export type IccMetadataValue = string | [number, number, number];

/** Metadata returned by npm icc's parse API; unknown versions/intents remain undefined. */
export interface IccMetadata {
  version: IccVersion | undefined;
  intent: IccIntent | undefined;
  cmm?: string;
  deviceClass?: string;
  colorSpace?: string;
  connectionSpace?: string;
  platform?: string;
  manufacturer?: string;
  model?: string;
  creator?: string;
  description?: IccMetadataValue;
  copyright?: IccMetadataValue;
  deviceModelDescription?: IccMetadataValue;
  viewingConditionsDescription?: IccMetadataValue;
  whitepoint?: IccMetadataValue;
}

const versions = new Map<number, IccVersion>([
  [0x02000000, '2.0'],
  [0x02100000, '2.1'],
  [0x02400000, '2.4'],
  [0x04000000, '4.0'],
  [0x04200000, '4.2'],
  [0x04300000, '4.3'],
  [0x04400000, '4.4'],
]);
const intents: readonly IccIntent[] = ['Perceptual', 'Relative', 'Saturation', 'Absolute'];
const names = new Map([
  ['scnr', 'Scanner'],
  ['mntr', 'Monitor'],
  ['prtr', 'Printer'],
  ['link', 'Link'],
  ['abst', 'Abstract'],
  ['spac', 'Space'],
  ['nmcl', 'Named color'],
  ['appl', 'Apple'],
  ['adbe', 'Adobe'],
  ['msft', 'Microsoft'],
  ['sunw', 'Sun Microsystems'],
  ['sgi', 'Silicon Graphics'],
  ['tgnt', 'Taligent'],
]);
const text = new TextDecoder('utf-8', { ignoreBOM: true });
const headerFields = [
  [4, 'cmm'],
  [12, 'deviceClass'],
  [16, 'colorSpace'],
  [20, 'connectionSpace'],
  [40, 'platform'],
  [48, 'manufacturer'],
  [52, 'model'],
  [80, 'creator'],
] as const;
const tagFields = new Map<
  string,
  'description' | 'copyright' | 'deviceModelDescription' | 'viewingConditionsDescription' | 'whitepoint'
>([
  ['desc', 'description'],
  ['cprt', 'copyright'],
  ['dmdd', 'deviceModelDescription'],
  ['vued', 'viewingConditionsDescription'],
  ['wtpt', 'whitepoint'],
] as const);

/** Decode a 128-byte ICC header, including icc's friendly device/platform names. */
export function readIccHeader(header: Uint8Array): IccMetadata {
  if (header.length !== 128 || text.decode(header.subarray(36, 40)) !== 'acsp')
    throw new Error('ICC: invalid profile header');
  const d = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const metadata: IccMetadata = { version: versions.get(d.getUint32(8)), intent: intents[d.getUint32(64)] };
  for (const [offset, field] of headerFields) {
    if (d.getUint32(offset) === 0) continue;
    const value = text.decode(header.subarray(offset, offset + 4)).trim();
    metadata[field] = names.get(value.toLowerCase()) ?? value;
  }
  return metadata;
}

/** Interpret icc-compatible metadata from a parsed or edited profile, retaining first mluc locale. */
export function readIccMetadata(profile: IccProfile): IccMetadata {
  const metadata = readIccHeader(profile.header);
  for (const tag of profile.tags) {
    const field = tagFields.get(tag.signature);
    if (!field) continue;
    const value = readIccTagValue(tag.data);
    if (value !== undefined) metadata[field] = value;
  }
  return metadata;
}

/** npm icc-compatible metadata parser. Accepts Buffer or Uint8Array with an exact profile length. */
export function parse(bytes: Uint8Array): IccMetadata {
  const profile = readIccProfile(bytes);
  if (new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) !== bytes.length)
    throw new Error('ICC: profile length mismatch');
  return readIccMetadata(profile);
}
