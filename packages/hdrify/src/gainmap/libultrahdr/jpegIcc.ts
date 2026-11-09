/** JPEG ICC APP2 transport. ICC profile semantics belong to hdrify-icc. */
import { readIccProfile } from 'hdrify-icc';

const PREFIX = new TextEncoder().encode('ICC_PROFILE\0');
const HEADER_SIZE = 14;
const CHUNK_SIZE = 65535 - 2 - HEADER_SIZE;

/** Split a validated raw ICC profile into APP2 payloads (without marker/length bytes). */
export function buildJpegIccPayloads(profile: Uint8Array): Uint8Array[] {
  const count = Math.ceil(profile.length / CHUNK_SIZE);
  if (count > 255) throw new Error('JPEG ICC: profile exceeds 255 APP2 chunks');
  readIccProfile(profile);
  return Array.from({ length: count }, (_, i) => {
    const chunk = profile.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const payload = new Uint8Array(HEADER_SIZE + chunk.length);
    payload.set(PREFIX);
    payload[12] = i + 1;
    payload[13] = count;
    payload.set(chunk, HEADER_SIZE);
    return payload;
  });
}

/** Read only the first JPEG image's header, reassembling ICC chunks in sequence order.
 * Returns null if absent. Throws on malformed headers or incomplete/ambiguous ICC chunks.
 * Entropy data and any concatenated secondary JPEG are never scanned for markers.
 */
export function extractJpegIccProfile(jpeg: Uint8Array): Uint8Array | null {
  const fail = (): never => {
    throw new Error('JPEG ICC: malformed header or chunk sequence');
  };
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return fail();
  const chunks = new Map<number, Uint8Array>();
  let count = 0;
  let position = 2;
  let terminated = false;
  while (position < jpeg.length) {
    if (jpeg[position++] !== 0xff) return fail();
    while (jpeg[position] === 0xff) position++;
    const marker = jpeg[position++];
    if (marker === undefined || marker === 0 || marker === 0xd8) return fail();
    if (marker === 0xd9) {
      terminated = true;
      break;
    }
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (position + 2 > jpeg.length) return fail();
    const length = jpeg[position]! * 256 + jpeg[position + 1]!;
    if (length < 2 || length > jpeg.length - position) return fail();
    const payload = jpeg.subarray(position + 2, position + length);
    position += length;
    if (marker === 0xda) {
      terminated = true;
      break;
    }
    if (marker !== 0xe2 || !PREFIX.every((b, i) => payload[i] === b)) continue;
    if (payload.length < HEADER_SIZE) return fail();
    const index = payload[12]!,
      total = payload[13]!;
    if (total === 0 || index === 0 || index > total || (count !== 0 && total !== count) || chunks.has(index))
      return fail();
    count = total;
    chunks.set(index, payload.subarray(HEADER_SIZE));
  }
  if (!terminated) return fail();
  if (!count) return null;
  if (chunks.size !== count) return fail();
  const out = new Uint8Array([...chunks.values()].reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (let i = 1; i <= count; i++) {
    const chunk = chunks.get(i)!;
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
