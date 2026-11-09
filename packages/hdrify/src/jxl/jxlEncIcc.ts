/** JPEG XL ICC transport; profile contents remain opaque. */
import type { JxlBitWriter } from './jxlBitWriter.js';
import { JxlEncEntropyCode } from './jxlEncEntropy.js';
import { iccContext } from './jxlImageHeader.js';

function varint(value: number): number[] {
  const bytes: number[] = [];
  do {
    const rest = Math.floor(value / 128);
    bytes.push((value % 128) | (rest ? 128 : 0));
    value = rest;
  } while (value);
  return bytes;
}

/** A valid literal ICC predictor stream. Entropy coding still compresses the residuals. */
export function predictJxlIcc(profile: Uint8Array): Uint8Array {
  const header = new Uint8Array(128);
  header.set(new TextEncoder().encode('mntrRGB XYZ '), 12);
  header.set(new TextEncoder().encode('acsp'), 36);
  header[8] = 4;
  header.set([246, 214], 70);
  header[73] = 1;
  header.set([211, 45], 78);
  new DataView(header.buffer).setUint32(0, profile.length);
  const residual = new Uint8Array(profile.length);
  for (let i = 0; i < 128; i++) {
    if (i === 8) header.set(profile.subarray(4, 8), 80);
    if (i === 41 && profile[40] === 0x41) header.set([0x50, 0x50, 0x4c], 41);
    if (i === 41 && profile[40] === 0x4d) header.set([0x53, 0x46, 0x54], 41);
    if (i === 42 && profile[40] === 0x53 && profile[41] === 0x47) header.set([0x49, 0x20], 42);
    if (i === 42 && profile[40] === 0x53 && profile[41] === 0x55) header.set([0x4e, 0x57], 42);
    residual[i] = profile[i]! - header[i]!;
  }
  residual.set(profile.subarray(128), 128);
  // Zero tag-list count disables tag prediction; insert the entire remaining profile literally.
  const commands = [0, 1, ...varint(profile.length - 128)];
  const prefix = [...varint(profile.length), ...varint(commands.length), ...commands];
  const out = new Uint8Array(prefix.length + residual.length);
  out.set(prefix);
  out.set(residual, prefix.length);
  return out;
}

export function writeJxlIcc(w: JxlBitWriter, profile: Uint8Array): void {
  const values = predictJxlIcc(profile);
  const contexts = Uint8Array.from(values, (_, i) => iccContext(i, values[i - 1] ?? 0, values[i - 2] ?? 0));
  const stream = { values, contexts };
  const code = JxlEncEntropyCode.build(41, [stream], new Uint8Array(41));
  w.writeU64(values.length);
  code.writeHeader(w);
  code.writeStream(w, stream);
}
