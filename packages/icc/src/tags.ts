/** Metadata tag codecs. Payloads include their eight-byte ICC type/reserved prefix. */
export type IccTagValue = string | [number, number, number];
export interface IccLocalizedText {
  language: string;
  /** Two-letter country code, or an empty string for an unspecified country. */
  country: string;
  text: string;
}
const signature = (bytes: Uint8Array) => String.fromCharCode(...bytes.subarray(0, 4));
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const invalid = () => new Error('ICC: malformed metadata tag');
const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });
const utf16 = new TextDecoder('utf-16be', { fatal: true, ignoreBOM: true });
const prefix = (type: string, size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set(Array.from(type, (c) => c.charCodeAt(0)));
  return bytes;
};
const ascii = (value: string) => {
  for (let i = 0; i < value.length; i++)
    if (value.charCodeAt(i) === 0 || value.charCodeAt(i) > 127)
      throw new Error('ICC: text must contain ASCII without NUL');
  return Uint8Array.from(value, (c) => c.charCodeAt(0));
};

/** Read every localized string, retaining the profile's record order and language/country codes. */
export function readIccLocalizedText(bytes: Uint8Array): IccLocalizedText[] | undefined {
  if (signature(bytes) !== 'mluc') return undefined;
  if (bytes.length < 16) throw invalid();
  const d = view(bytes),
    count = d.getUint32(8),
    recordSize = d.getUint32(12);
  if (recordSize !== 12 || count > (bytes.length - 16) / 12) throw invalid();
  const tableEnd = 16 + count * 12;
  const records: IccLocalizedText[] = [];
  for (let i = 0; i < count; i++) {
    const p = 16 + i * 12,
      length = d.getUint32(p + 4),
      offset = d.getUint32(p + 8);
    if (length % 2 !== 0 || offset < tableEnd || offset > bytes.length || length > bytes.length - offset)
      throw invalid();
    records.push({
      language: String.fromCharCode(bytes[p]!, bytes[p + 1]!),
      country: d.getUint16(p + 2) === 0 ? '' : String.fromCharCode(bytes[p + 2]!, bytes[p + 3]!),
      text: utf16.decode(bytes.subarray(offset, offset + length)),
    });
  }
  return records;
}

/** Decode the metadata types understood by npm icc; unknown payload types stay opaque. */
export function readIccTagValue(bytes: Uint8Array): IccTagValue | undefined {
  const type = signature(bytes);
  if (!['desc', 'text', 'mluc', 'XYZ '].includes(type)) return undefined;
  if (bytes.length < 8) throw invalid();
  if (type === 'mluc') return readIccLocalizedText(bytes)?.[0]?.text;
  if (type === 'text') return utf8.decode(bytes.subarray(8)).replace(/\0+$/, '');
  const d = view(bytes);
  if (type === 'desc') {
    if (bytes.length < 12) throw invalid();
    const count = d.getUint32(8);
    if (count > bytes.length - 12) throw invalid();
    if (count === 0) return '';
    if (bytes[11 + count] !== 0) throw invalid();
    return utf8.decode(bytes.subarray(12, 11 + count));
  }
  if (bytes.length < 20) throw invalid();
  return [d.getInt32(8) / 65536, d.getInt32(12) / 65536, d.getInt32(16) / 65536];
}

/** Author an ICC v2 ASCII textType, including its terminating NUL. */
export function writeIccText(value: string): Uint8Array {
  const encoded = ascii(value),
    bytes = prefix('text', 9 + encoded.length);
  bytes.set(encoded, 8);
  return bytes;
}

/** Author a v2 textDescriptionType with empty Unicode and ScriptCode extensions. */
export function writeIccDescription(value: string): Uint8Array {
  const encoded = ascii(value),
    count = encoded.length + 1,
    bytes = prefix('desc', 12 + count + 78);
  view(bytes).setUint32(8, count);
  bytes.set(encoded, 12);
  return bytes;
}

/** Author a v4 multiLocalizedUnicodeType (UTF-16BE), preserving all records. */
export function writeIccLocalizedText(records: readonly IccLocalizedText[]): Uint8Array {
  let size = 16 + records.length * 12;
  for (const record of records) {
    if (!/^[a-z]{2}$/.test(record.language) || (record.country !== '' && !/^[A-Z]{2}$/.test(record.country)))
      throw new Error('ICC: invalid language or country code');
    if (!record.text.isWellFormed()) throw new Error('ICC: invalid Unicode text');
    size += record.text.length * 2;
  }
  if (size > 0xffffffff) throw new Error('ICC: metadata tag exceeds the 32-bit size limit');
  const bytes = prefix('mluc', size),
    d = view(bytes);
  d.setUint32(8, records.length);
  d.setUint32(12, 12);
  let offset = 16 + records.length * 12;
  records.forEach((record, i) => {
    const p = 16 + i * 12;
    bytes[p] = record.language.charCodeAt(0);
    bytes[p + 1] = record.language.charCodeAt(1);
    if (record.country !== '') {
      bytes[p + 2] = record.country.charCodeAt(0);
      bytes[p + 3] = record.country.charCodeAt(1);
    }
    d.setUint32(p + 4, record.text.length * 2);
    d.setUint32(p + 8, offset);
    for (let j = 0; j < record.text.length; j++) d.setUint16(offset + j * 2, record.text.charCodeAt(j));
    offset += record.text.length * 2;
  });
  return bytes;
}

/** Author one XYZNumber, quantized to signed 15.16 fixed point. */
export function writeIccXyz(value: readonly [number, number, number]): Uint8Array {
  const bytes = prefix('XYZ ', 20),
    d = view(bytes);
  value.forEach((v, i) => {
    const encoded = Math.round(v * 65536);
    if (!Number.isFinite(v) || v < -32768 || v > 0x7fffffff / 65536 || encoded < -0x80000000 || encoded > 0x7fffffff)
      throw new Error('ICC: XYZ value exceeds signed 15.16 range');
    d.setInt32(8 + i * 4, encoded);
  });
  return bytes;
}
