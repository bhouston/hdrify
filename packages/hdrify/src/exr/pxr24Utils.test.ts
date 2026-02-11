import { describe, expect, it } from 'vitest';
import { transposePxr24Bytes, undoPxr24Transposition } from './pxr24Utils.js';

describe('PXR24 transposition', () => {
  it('transpose and undo are inverses', () => {
    const bytesPerSample = 2;
    const seq = new Uint8Array(16);
    for (let i = 0; i < seq.length; i++) {
      seq[i] = i;
    }
    const transposed = transposePxr24Bytes(seq, bytesPerSample);
    const back = undoPxr24Transposition(transposed, bytesPerSample);
    expect(back).toEqual(seq);
  });

  it('undo and transpose are inverses', () => {
    const bytesPerSample = 2;
    const transposed = new Uint8Array([0, 4, 1, 5, 2, 6, 3, 7, 8, 12, 9, 13, 10, 14, 11, 15]);
    const sequential = undoPxr24Transposition(transposed, bytesPerSample);
    const back = transposePxr24Bytes(sequential, bytesPerSample);
    expect(back).toEqual(transposed);
  });

  it('transpose produces [all_lo][all_hi] for HALF', () => {
    const sequential = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]); // [lo0,hi0, lo1,hi1, lo2,hi2, lo3,hi3]
    const transposed = transposePxr24Bytes(sequential, 2);
    expect(transposed[0]).toBe(0);
    expect(transposed[1]).toBe(2);
    expect(transposed[2]).toBe(4);
    expect(transposed[3]).toBe(6);
    expect(transposed[4]).toBe(1);
    expect(transposed[5]).toBe(3);
    expect(transposed[6]).toBe(5);
    expect(transposed[7]).toBe(7);
  });

  it('transpose/undo work for 3-byte FLOAT samples', () => {
    const bytesPerSample = 3;
    const seq = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]); // 3 samples
    const transposed = transposePxr24Bytes(seq, bytesPerSample);
    // [b0,b1,b2, b3,b4,b5, b6,b7,b8] -> [b0,b3,b6, b1,b4,b7, b2,b5,b8]
    expect(transposed[0]).toBe(0);
    expect(transposed[1]).toBe(3);
    expect(transposed[2]).toBe(6);
    expect(transposed[3]).toBe(1);
    expect(transposed[4]).toBe(4);
    expect(transposed[5]).toBe(7);
    expect(transposed[6]).toBe(2);
    expect(transposed[7]).toBe(5);
    expect(transposed[8]).toBe(8);
    const back = undoPxr24Transposition(transposed, bytesPerSample);
    expect(back).toEqual(seq);
  });

  it('undo produces [lo0,hi0, lo1,hi1, ...] from [all_lo][all_hi]', () => {
    const transposed = new Uint8Array([10, 20, 30, 40, 11, 21, 31, 41]); // 4 samples, 2 bytes each
    const sequential = undoPxr24Transposition(transposed, 2);
    expect(sequential[0]).toBe(10);
    expect(sequential[1]).toBe(11);
    expect(sequential[2]).toBe(20);
    expect(sequential[3]).toBe(21);
    expect(sequential[4]).toBe(30);
    expect(sequential[5]).toBe(31);
    expect(sequential[6]).toBe(40);
    expect(sequential[7]).toBe(41);
  });
});
