import { describe, expect, it } from 'vitest';
import { applyExrPredictor, reorderExrPixels } from './exrDsp.js';
import { applyExrPredictorEncode, reorderForWriting } from './exrDspWrite.js';

describe('reorderForWriting', () => {
  it('is inverse of reorderExrPixels', () => {
    const interleaved = new Uint8Array([0, 2, 1, 3]);
    const planar = new Uint8Array(4);
    reorderForWriting(planar, interleaved);
    expect(planar).toEqual(new Uint8Array([0, 1, 2, 3]));

    const back = new Uint8Array(4);
    reorderExrPixels(back, planar);
    expect(back).toEqual(interleaved);
  });

  it('round-trips with reorderExrPixels', () => {
    const orig = new Uint8Array([0xab, 0xcd, 0xef, 0x12]);
    const planar = new Uint8Array(4);
    reorderForWriting(planar, orig);
    const back = new Uint8Array(4);
    reorderExrPixels(back, planar);
    expect(back).toEqual(orig);
  });
});

describe('applyExrPredictorEncode', () => {
  it('is inverse of applyExrPredictor', () => {
    const raw = new Uint8Array([0x00, 0x80, 0x00, 0x80]);
    const encoded = new Uint8Array(raw);
    applyExrPredictorEncode(encoded);
    expect(encoded).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x00]));

    const decoded = new Uint8Array(encoded);
    applyExrPredictor(decoded);
    expect(decoded).toEqual(raw);
  });

  it('round-trips arbitrary data', () => {
    const raw = new Uint8Array([0x42, 0xab, 0x11, 0x22, 0x33, 0x44]);
    const encoded = new Uint8Array(raw);
    applyExrPredictorEncode(encoded);
    const decoded = new Uint8Array(encoded);
    applyExrPredictor(decoded);
    expect(decoded).toEqual(raw);
  });
});
