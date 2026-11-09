import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { readIccProfile, writeIccProfile } from 'hdrify-icc';
import { JxlBitReader } from './jxlBitReader.js';
import { JxlBitWriter } from './jxlBitWriter.js';
import { extractCodestream } from './jxlContainer.js';
import { readImageHeader, unpredictIcc, readIccProfile as readJxlIcc } from './jxlImageHeader.js';
import { predictJxlIcc, writeJxlIcc } from './jxlEncIcc.js';
import { readJxl } from './readJxl.js';
import { writeJxl, writeJxlEncoded } from './writeJxl.js';

const load = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../../assets/jxl/color/${name}.icc`, import.meta.url)));
const samples = () => Float32Array.from({ length: 256 }, (_, i) => [0.2, 0.35, 0.5, 0.7][i % 4]);
const header = (bytes: Uint8Array) => readImageHeader(new JxlBitReader(extractCodestream(bytes).codestream));

for (const name of ['adobe_rgb', 'display_p3', 'prophoto', 'pq_icc']) {
  it(`retains explicit ${name} profile bytes`, () => {
    const iccProfile = load(name);
    const data = samples();
    const before = data.slice();
    const bytes = writeJxlEncoded({ width: 8, height: 8, data, iccProfile }, { bitDepth: 'float32', container: true });
    expect(data).toEqual(before);
    expect(header(bytes).icc).toEqual(iccProfile);
  });
}
it('retains RGB LUT profiles and opaque tags without evaluating the profile', () => {
  const parsed = readIccProfile(load('adobe_rgb'));
  parsed.tags.push({ signature: 'test', data: Uint8Array.from([1, 2, 3, 4, 5]) });
  parsed.tags.push({ signature: 'A2B0', data: new Uint8Array(12) });
  const iccProfile = writeIccProfile(parsed);
  const bytes = writeJxlEncoded({ width: 8, height: 8, data: samples(), iccProfile }, { bitDepth: 'float32' });
  expect(header(bytes).icc).toEqual(iccProfile);
  // The decoder cannot colour-manage LUT profiles and rejects them instead of guessing.
  expect(() => readJxl(bytes)).toThrow('LUT-based');
});
it('transports arbitrary RGB, gray, CMYK profiles with opaque tags and header platform variants', () => {
  const parsed = readIccProfile(load('adobe_rgb'));
  parsed.tags.push({ signature: 'test', data: Uint8Array.from([1, 2, 3, 4, 5]) });
  for (const space of ['RGB ', 'GRAY', 'CMYK'])
    for (const platform of ['APPL', 'MSFT', 'SGI ', 'SUNW']) {
      parsed.header.set(new TextEncoder().encode(platform), 40);
      parsed.header.set(new TextEncoder().encode(space), 16);
      const icc = writeIccProfile(parsed);
      expect(unpredictIcc(predictJxlIcc(icc))).toEqual(icc);
      const writer = new JxlBitWriter();
      writeJxlIcc(writer, icc);
      expect(readJxlIcc(new JxlBitReader(writer.finish()))).toEqual(icc);
    }
});
it('rejects malformed profiles, trailing bytes, non-RGB layouts, and lossy encoded samples', () => {
  const image = { width: 8, height: 8, data: samples(), iccProfile: new Uint8Array(140) };
  expect(() => writeJxlEncoded(image)).toThrow('ICC');
  const parsed = readIccProfile(load('adobe_rgb'));
  for (const space of ['CMYK', 'GRAY']) {
    parsed.header.set(new TextEncoder().encode(space), 16);
    expect(() => writeJxlEncoded({ ...image, iccProfile: writeIccProfile(parsed) })).toThrow('RGB');
  }
  const valid = load('adobe_rgb');
  const trailing = new Uint8Array(valid.length + 1);
  trailing.set(valid);
  expect(() => writeJxlEncoded({ ...image, iccProfile: trailing })).toThrow('trailing');
  expect(() => writeJxlEncoded({ ...image, iccProfile: valid }, { lossy: true })).toThrow('lossless');
});
it('does not attach source ICC metadata automatically', () => {
  const source = {
    width: 8,
    height: 8,
    data: samples(),
    linearColorSpace: 'linear-rec709' as const,
    metadata: { iccProfile: load('adobe_rgb') },
  };
  expect(header(writeJxl(source)).icc).toBeUndefined();
});

it('retains profiles with high effort, integer samples and multiple Modular groups', () => {
  const iccProfile = load('adobe_rgb');
  const data = Float32Array.from({ length: 129 * 4 }, (_, i) => [0.2, 0.35, 0.5, 0.7][i % 4]);
  const bytes = writeJxlEncoded(
    { width: 129, height: 1, data, iccProfile },
    { effort: 'high', bitDepth: 'uint8', groupSizeShift: 0 },
  );
  const decoded = readJxl(bytes);
  expect(decoded.width).toBe(129);
  expect(decoded.metadata?.iccProfile).toEqual(iccProfile);
  expect(decoded.data[3]).toBeCloseTo(Math.round(data[3] * 255) / 255, 6);
});
