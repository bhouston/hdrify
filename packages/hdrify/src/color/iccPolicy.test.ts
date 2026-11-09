import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSrgbIccProfile, readIccProfile, writeIccProfile } from 'hdrify-icc';
import { iccLinearRgb, interpretIccProfile } from './iccPolicy.js';

const load = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../../assets/jxl/color/${name}.icc`, import.meta.url)));
const withCicp = (primaries: number, transfer: number) => {
  const p = readIccProfile(createSrgbIccProfile());
  p.tags.push({ signature: 'cicp', data: new Uint8Array([99, 105, 99, 112, 0, 0, 0, 0, primaries, transfer, 0, 1]) });
  return writeIccProfile(p);
};

describe('shared ICC policy', () => {
  it('snaps matching matrix/TRC primaries to native linear spaces and adapts others to Rec.2020', () => {
    expect(iccLinearRgb(createSrgbIccProfile(), 'T')).not.toHaveProperty('toOutput');
    expect(iccLinearRgb(createSrgbIccProfile(), 'T').space).toBe('linear-rec709');
    expect(iccLinearRgb(load('display_p3'), 'T').space).toBe('linear-p3');
    const adobe = iccLinearRgb(load('adobe_rgb'), 'T');
    expect(adobe.space).toBe('linear-rec2020');
    // White stays white after Bradford adaptation.
    for (const row of adobe.toOutput!) expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 3);
  });

  it('prefers recognized cICP and rejects HDR transfers for SDR-referred samples', () => {
    expect(interpretIccProfile(withCicp(12, 13), 'T').cicp).toEqual({ primaries: 'p3', transferFunction: 'srgb' });
    expect(iccLinearRgb(withCicp(9, 8), 'T').space).toBe('linear-rec2020');
    expect(() => iccLinearRgb(withCicp(9, 16), 'T')).toThrow("T: ICC cICP transfer 'pq' is not supported");
  });

  it('throws one descriptive error for profiles it cannot evaluate', () => {
    const p = readIccProfile(createSrgbIccProfile());
    p.header.set(new TextEncoder().encode('CMYK'), 16);
    expect(() => interpretIccProfile(writeIccProfile(p), 'JXL')).toThrow(
      "JXL: embedded ICC profile cannot be colour-managed ('mntr' class, 'CMYK' colour space",
    );
  });
});
