import type { IccProfile, IccTag } from './index.js';

/** Raw ICC v2/v4 header fields. Signatures and version remain uninterpreted, so future
 * values, unregistered devices, and all color spaces can be edited without a CMS.
 */
export interface IccHeader {
  profileSize: number;
  preferredCmm: string;
  version: number;
  deviceClass: string;
  colorSpace: string;
  pcs: string;
  creationDate: [number, number, number, number, number, number];
  platform: string;
  flags: number;
  manufacturer: string;
  model: string;
  deviceAttributes: bigint;
  renderingIntent: number;
  illuminant: [number, number, number];
  creator: string;
  profileId: Uint8Array;
  reserved: Uint8Array;
}

/** Decode all 128 header bytes; byte array fields are owned copies. */
export function readIccHeader(bytes: Uint8Array): IccHeader {
  if (bytes.length < 128 || String.fromCharCode(...bytes.subarray(36, 40)) !== 'acsp')
    throw new Error('ICC: invalid profile header');
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sig = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  return {
    profileSize: d.getUint32(0),
    preferredCmm: sig(4),
    version: d.getUint32(8),
    deviceClass: sig(12),
    colorSpace: sig(16),
    pcs: sig(20),
    creationDate: [24, 26, 28, 30, 32, 34].map((o) => d.getUint16(o)) as IccHeader['creationDate'],
    platform: sig(40),
    flags: d.getUint32(44),
    manufacturer: sig(48),
    model: sig(52),
    deviceAttributes: d.getBigUint64(56),
    renderingIntent: d.getUint32(64),
    illuminant: [68, 72, 76].map((o) => d.getInt32(o) / 65536) as IccHeader['illuminant'],
    creator: sig(80),
    profileId: Uint8Array.from(bytes.subarray(84, 100)),
    reserved: Uint8Array.from(bytes.subarray(100, 128)),
  };
}

/** Encode a complete header, retaining unknown values and reserved bytes.
 * writeIccProfile subsequently recomputes profileSize and clears the stale profileId.
 */
export function writeIccHeader(header: IccHeader): Uint8Array {
  const bytes = new Uint8Array(128),
    d = new DataView(bytes.buffer);
  const uint = (o: number, value: number, bits = 32) => {
    if (!Number.isInteger(value) || value < 0 || value > 2 ** bits - 1) throw new Error('ICC: invalid header integer');
    if (bits === 16) d.setUint16(o, value);
    else d.setUint32(o, value);
  };
  const sig = (o: number, value: string) => {
    if (value.length !== 4 || Array.from(value, (c) => c.charCodeAt(0)).some((c) => c > 255))
      throw new Error('ICC: invalid header signature');
    bytes.set(
      Array.from(value, (c) => c.charCodeAt(0)),
      o,
    );
  };
  uint(0, header.profileSize);
  sig(4, header.preferredCmm);
  uint(8, header.version);
  sig(12, header.deviceClass);
  sig(16, header.colorSpace);
  sig(20, header.pcs);
  if (header.creationDate.length !== 6 || header.illuminant.length !== 3) throw new Error('ICC: invalid header vector');
  header.creationDate.forEach((v, i) => uint(24 + i * 2, v, 16));
  sig(36, 'acsp');
  sig(40, header.platform);
  uint(44, header.flags);
  sig(48, header.manufacturer);
  sig(52, header.model);
  if (header.deviceAttributes < 0n || header.deviceAttributes > 0xffffffffffffffffn)
    throw new Error('ICC: invalid device attributes');
  d.setBigUint64(56, header.deviceAttributes);
  uint(64, header.renderingIntent);
  header.illuminant.forEach((v, i) => {
    const fixed = Math.round(v * 65536);
    if (!Number.isFinite(v) || fixed < -0x80000000 || fixed > 0x7fffffff) throw new Error('ICC: invalid illuminant');
    d.setInt32(68 + i * 4, fixed);
  });
  sig(80, header.creator);
  if (header.profileId.length !== 16 || header.reserved.length !== 28)
    throw new Error('ICC: invalid header byte field');
  bytes.set(header.profileId, 84);
  bytes.set(header.reserved, 100);
  return bytes;
}

/** Find the first tag. Its payload can be edited directly; unknown types are opaque. */
export function getIccTag(profile: IccProfile, signature: string): IccTag | undefined {
  return profile.tags.find((tag) => tag.signature === signature);
}

/** Replace the first matching tag or append one, owning a copy of the supplied data.
 * Any later duplicate signatures are preserved; use removeIccTags to remove all copies.
 */
export function setIccTag(profile: IccProfile, signature: string, data: Uint8Array): void {
  if (!/^[\x20-\x7e]{4}$/.test(signature)) throw new Error('ICC: tag signatures must be four bytes');
  const tag = getIccTag(profile, signature);
  if (tag) tag.data = Uint8Array.from(data);
  else profile.tags.push({ signature, data: Uint8Array.from(data) });
}

/** Remove every matching tag, returning the number removed. */
export function removeIccTags(profile: IccProfile, signature: string): number {
  const oldLength = profile.tags.length;
  profile.tags = profile.tags.filter((tag) => tag.signature !== signature);
  return oldLength - profile.tags.length;
}
