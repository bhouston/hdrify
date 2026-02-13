/**
 * Build a minimal ICC v4 Display profile with BT.2020/PQ and ADGC (Adaptive Gain Curve) tag
 * per ICC.1 (April 2025) so Apple Preview shows "BT.2020 Primaries; PQ (Adaptive Gain Curve...)" and 10-bit.
 * All multi-byte values in ICC are big-endian.
 */

const ICC_HEADER_SIZE = 128;
const TAG_ENTRY_SIZE = 12;

/** Profile description for Preview display (GUID suffix matches ADGC tag for Apple) */
const ADGC_GUID_HEX = [0x97, 0xe9, 0xf8, 0x5a, 0xa5, 0xca, 0x71, 0x90]
  .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
  .join('');
const PROFILE_DESC = `BT.2020 Primaries; PQ (Adaptive Gain Curve ${ADGC_GUID_HEX})`;

/** GUID from Apple Preview display (8 bytes + 8 zero padding for 16-byte GUID) */
const ADGC_GUID = new Uint8Array([
  0x97, 0xe9, 0xf8, 0x5a, 0xa5, 0xca, 0x71, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/** Tag signatures */
const TAG_DESC = 0x64657363; // 'desc'
const TAG_ADGC = 0x41444743; // 'ADGC'

/** Type signatures */
const TYPE_MLUC = 0x6d6c7563; // 'mluc' multiLocalizedUnicodeType
const TYPE_ADGC = 0x61646763; // 'adgc' adaptiveGainCurveType

/**
 * Build ICC v4 profile with desc and ADGC tags, then return JPEG APP2 payload
 * (ICC_PROFILE\0 + chunk 1/1 + profile bytes).
 */
export function buildIccBt2020PqAdgcPayload(): Uint8Array {
  const descUtf16 = stringToUtf16Be(PROFILE_DESC);
  const descRecordDataLen = descUtf16.length;
  const descRecordSize = 12 + descRecordDataLen; // 2 lang + 2 country + 4 length + string
  const descRecordSizePadded = (descRecordSize + 3) & ~3;
  const descDataSize = 4 + 4 + 4 + 4 + descRecordSizePadded; // type 'mluc', reserved, count, record size, record
  const descData = new Uint8Array(descDataSize);
  const dvDesc = new DataView(descData.buffer, descData.byteOffset, descData.byteLength);
  let o = 0;
  dvDesc.setUint32(o, TYPE_MLUC, false); // 'mluc'
  o += 4;
  dvDesc.setUint32(o, 0, false);
  o += 4;
  dvDesc.setUint32(o, 1, false); // 1 record
  o += 4;
  dvDesc.setUint32(o, descRecordSize, false); // record size (12 + string length)
  o += 4;
  dvDesc.setUint16(o, 0x656e, false); // 'en'
  o += 2;
  dvDesc.setUint16(o, 0x5553, false); // 'US'
  o += 2;
  dvDesc.setUint32(o, descRecordDataLen, false);
  o += 4;
  descData.set(descUtf16, o);
  o += descRecordDataLen;
  while (o < descDataSize) descData[o++] = 0;

  const tagTableStart = ICC_HEADER_SIZE;
  const tagCount = 2;
  const tagTableSize = 4 + tagCount * TAG_ENTRY_SIZE;
  const descOffset = tagTableStart + tagTableSize;
  const descPaddedLen = (descDataSize + 3) & ~3;
  const adgcOffset = descOffset + descPaddedLen;

  const curveCount = 2;
  const curveDataSize = 4 + curveCount * 12; // count (4) + triplets (x,y,slope) × 2
  const adgcHeaderSize = 148; // type to curve count (inclusive)
  const adgcTagDataSize = adgcHeaderSize + curveDataSize;
  const curveOffsetInProfile = adgcOffset + adgcHeaderSize;

  const adgcTagData = new Uint8Array(adgcTagDataSize);
  const dvAdgc = new DataView(adgcTagData.buffer, adgcTagData.byteOffset, adgcTagData.byteLength);
  let a = 0;
  dvAdgc.setUint32(a, TYPE_ADGC, false); // 'adgc' type
  a += 4;
  dvAdgc.setUint32(a, 0, false);
  a += 4;
  dvAdgc.setUint32(a, 1, false); // function type 1
  a += 4;
  adgcTagData.set(ADGC_GUID, a);
  a += 16;
  dvAdgc.setFloat32(a, 0, false); // Hbaseline
  a += 4;
  dvAdgc.setFloat32(a, 4, false); // Halternate (log2 headroom)
  a += 4;
  dvAdgc.setFloat32(a, -4, false);
  a += 4;
  dvAdgc.setFloat32(a, 4, false);
  a += 4;
  dvAdgc.setFloat32(a, 1 / 3, false);
  a += 4;
  dvAdgc.setFloat32(a, -4, false);
  a += 4;
  dvAdgc.setFloat32(a, 4, false);
  a += 4;
  dvAdgc.setFloat32(a, 1 / 3, false);
  a += 4;
  dvAdgc.setFloat32(a, -4, false);
  a += 4;
  dvAdgc.setFloat32(a, 4, false);
  a += 4;
  dvAdgc.setFloat32(a, 1 / 3, false);
  a += 4;
  dvAdgc.setFloat32(a, 0.25, false);
  a += 4;
  dvAdgc.setFloat32(a, 0.25, false);
  a += 4;
  dvAdgc.setFloat32(a, 0.25, false);
  a += 4;
  dvAdgc.setUint32(a, 0, false); // pre CICP
  a += 4;
  dvAdgc.setUint32(a, 0, false); // post CICP
  a += 4;
  dvAdgc.setFloat32(a, 0, false);
  a += 4;
  dvAdgc.setFloat32(a, 0, false);
  a += 4;
  dvAdgc.setFloat32(a, 0, false);
  a += 4;
  dvAdgc.setUint32(a, curveOffsetInProfile, false);
  a += 4;
  dvAdgc.setUint32(a, curveDataSize, false);
  a += 4;
  dvAdgc.setUint32(a, curveOffsetInProfile, false);
  a += 4;
  dvAdgc.setUint32(a, curveDataSize, false);
  a += 4;
  dvAdgc.setUint32(a, curveOffsetInProfile, false);
  a += 4;
  dvAdgc.setUint32(a, curveDataSize, false);
  a += 4;
  dvAdgc.setUint32(a, 0, false);
  a += 4;
  dvAdgc.setUint32(a, curveCount, false);
  a += 4;
  dvAdgc.setFloat32(a, 0, false);
  dvAdgc.setFloat32(a + 4, 0, false);
  dvAdgc.setFloat32(a + 8, 1, false);
  a += 12;
  dvAdgc.setFloat32(a, 1, false);
  dvAdgc.setFloat32(a + 4, 1, false);
  dvAdgc.setFloat32(a + 8, 1, false);

  const profileSize = adgcOffset + (adgcTagDataSize + 3 & ~3);

  const profile = new Uint8Array(profileSize);
  const dv = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  let p = 0;
  dv.setUint32(p, profileSize, false);
  p += 4;
  dv.setUint32(p, 0, false);
  p += 4;
  dv.setUint32(p, 0x04000000, false); // version 4.0
  p += 4;
  profile.set([0x6d, 0x6e, 0x74, 0x72], p); // mntr
  p += 4;
  profile.set([0x52, 0x47, 0x42, 0x20], p); // RGB
  p += 4;
  profile.set([0x58, 0x59, 0x5a, 0x20], p); // XYZ
  p += 4;
  dv.setUint16(p, 2025, false);
  dv.setUint16(p + 2, 4, false);
  dv.setUint16(p + 4, 17, false);
  dv.setUint16(p + 6, 0, false);
  dv.setUint16(p + 8, 0, false);
  dv.setUint16(p + 10, 0, false);
  p += 12;
  profile.set([0x61, 0x63, 0x73, 0x70], p); // acsp
  p += 4;
  dv.setUint32(p, 0x4150504c, false); // APPL
  p += 4;
  dv.setUint32(p, 3, false); // embedded + cannot use independently
  p += 4;
  dv.setUint32(p, 0, false);
  p += 4;
  dv.setUint32(p, 0, false);
  p += 4;
  dv.setUint32(p, 0, false);
  p += 4;
  dv.setUint32(p, 0, false);
  p += 4;
  dv.setUint32(p, 0x0000f6d6, false);
  dv.setUint32(p + 4, 0x00010000, false);
  dv.setUint32(p + 8, 0x0000d32d, false);
  p += 12;
  dv.setUint32(p, 0, false);
  dv.setUint32(p + 4, 0, false);
  dv.setUint32(p + 8, 0, false);
  dv.setUint32(p + 12, 0, false);
  p += 16;
  for (let i = 0; i < 28; i++) dv.setUint8(p + i, 0);
  p += 28;

  dv.setUint32(p, tagCount, false);
  p += 4;
  dv.setUint32(p, TAG_DESC, false);
  dv.setUint32(p + 4, descOffset, false);
  dv.setUint32(p + 8, descDataSize, false);
  p += 12;
  dv.setUint32(p, TAG_ADGC, false);
  dv.setUint32(p + 4, adgcOffset, false);
  dv.setUint32(p + 8, adgcTagDataSize, false);
  p += 12;

  profile.set(descData, descOffset);
  profile.set(adgcTagData, adgcOffset);

  const jpegPayload = new Uint8Array(14 + profileSize);
  const iccId = new TextEncoder().encode('ICC_PROFILE\0');
  jpegPayload.set(iccId, 0);
  jpegPayload[12] = 1;
  jpegPayload[13] = 1;
  jpegPayload.set(profile, 14);
  return jpegPayload;
}

function stringToUtf16Be(s: string): Uint8Array {
  const n = s.length * 2;
  const out = new Uint8Array(n);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = (c >> 8) & 0xff;
    out[i * 2 + 1] = c & 0xff;
  }
  return out;
}
