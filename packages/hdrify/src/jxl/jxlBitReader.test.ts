import { describe, expect, it } from 'vitest';
import { JxlBitReader, unpackSigned } from './jxlBitReader.js';

describe('JxlBitReader', () => {
  it('reads bits LSB-first across byte boundaries', () => {
    const br = new JxlBitReader(new Uint8Array([0b1010_1101, 0b0000_0011, 0xff, 0xff, 0x12, 0x34]));
    expect(br.readBits(1)).toBe(1);
    expect(br.readBits(3)).toBe(0b110);
    expect(br.readBits(6)).toBe(0b11_1010);
    expect(br.bitPosition).toBe(10);
    br.zeroPadToByte();
    expect(br.readBits(32)).toBe(0x3412ffff);
  });

  it('reads the JXL signature and peeks/skips', () => {
    const br = new JxlBitReader(new Uint8Array([0xff, 0x0a]));
    expect(br.peekBits(16)).toBe(0x0aff);
    br.skipBits(8);
    expect(br.readBits(8)).toBe(0x0a);
  });

  it('decodes U32, U64, Enum and F16 fields', () => {
    // selector 2 -> BitsOffset(4, 2): bits = 2 (sel) then 4 bits value 5 => 0b0101_10
    const br = new JxlBitReader(new Uint8Array([0b0101_10 | (0b01 << 6), 0b0000_0011]));
    expect(br.readU32(0, 1, { bits: 4, offset: 2 }, 7)).toBe(7);
    // remaining: bits from byte0 >> 6 = 01 => sel 1 => 1 + u(4)
    expect(br.readU64()).toBe(1 + 0b0011);

    const half = new JxlBitReader(new Uint8Array([0x00, 0x3c]));
    expect(half.readF16()).toBe(1);
    const neg = new JxlBitReader(new Uint8Array([0x00, 0xc0]));
    expect(neg.readF16()).toBe(-2);
    expect(() => new JxlBitReader(new Uint8Array([0x00, 0x7c])).readF16()).toThrow();

    const e = new JxlBitReader(new Uint8Array([0b1]));
    expect(e.readEnum()).toBe(1);
  });

  it('rejects non-zero padding and reading far past the end', () => {
    const br = new JxlBitReader(new Uint8Array([0b10]));
    br.readBits(1);
    expect(() => br.zeroPadToByte()).toThrow();
    const end = new JxlBitReader(new Uint8Array([1]));
    expect(() => end.skip(200)).toThrow();
  });

  it('allows lookahead beyond EOF but rejects consuming those bits', () => {
    const br = new JxlBitReader(new Uint8Array([0xa5]));
    expect(br.peekBits(15)).toBe(0xa5);
    br.readBits(8);
    expect(() => br.checkBounds()).not.toThrow();
    br.skipBits(1);
    expect(() => br.checkBounds()).toThrow(/unexpected end/);
  });

  it('validates reader ranges against the supplied view', () => {
    const bytes = new Uint8Array(8).subarray(2, 6);
    for (const [offset, length] of [
      [-1, 1],
      [0, -1],
      [3, 2],
      [5, 0],
      [0.5, 1],
      [0, NaN],
    ]) {
      expect(() => new JxlBitReader(bytes, offset, length)).toThrow(/range/);
    }
    expect(() => new JxlBitReader(bytes, 4, 0)).not.toThrow();
  });

  it('unpackSigned zig-zags', () => {
    expect([0, 1, 2, 3, 4].map(unpackSigned)).toEqual([0, -1, 1, -2, 2]);
  });
});

describe('JxlBitWriter round-trip', async () => {
  const { JxlBitWriter } = await import('./jxlBitWriter.js');
  it('appends offset views across growths and resumes bit writes', () => {
    const w = new JxlBitWriter();
    const source = Uint8Array.from({ length: 9002 }, (_, i) => i & 0xff);
    const view = source.subarray(1, -1);
    w.writeBits(8, 0xa5);
    w.writeBytes(new Uint8Array());
    w.writeBytes(view);
    // Appends must copy: later changes to the source cannot change encoded bytes.
    const expected = new Uint8Array([0xa5, ...view, ...view, 0xff]);
    w.writeBytes(view);
    source.fill(0);
    w.writeBits(3, 7);
    expect(() => w.writeBytes(view)).toThrow(/not byte-aligned/);
    w.writeBits(5, 31);
    expect(w.finish()).toEqual(expected);
    expect(w.bitPosition).toBe(expected.length * 8);
  });

  for (const capacity of [1024, 2048]) {
    for (let bits = 1; bits < 8; bits++) {
      it(`preserves ${bits} pending bits after ${capacity} flushed bytes`, () => {
        const w = new JxlBitWriter();
        const prefix = Uint8Array.from({ length: capacity }, (_, i) => i & 0xff);
        w.writeBytes(prefix);
        const tail = (1 << bits) - 1;
        w.writeBits(bits, tail);
        const finished = w.finish();
        expect(finished.length).toBe(capacity + 1);
        expect(finished.subarray(0, capacity)).toEqual(prefix);
        expect(finished[capacity]).toBe(tail);
        expect(w.finish()).toEqual(finished);
        expect(w.bitPosition).toBe(capacity * 8 + bits);

        // finish() leaves the pending bits intact for subsequent writes.
        w.writeBits(8 - bits, 0);
        w.writeBytes(new Uint8Array([0xa5]));
        expect(w.finish()).toEqual(new Uint8Array([...finished, 0xa5]));
        expect(finished.length).toBe(capacity + 1);
      });
    }
  }

  it('writes what JxlBitReader reads', () => {
    const w = new JxlBitWriter();
    w.writeBits(3, 5);
    w.writeU32(19, 0, 1, { bits: 4, offset: 2 }, { bits: 6, offset: 18 });
    w.writeU64(0);
    w.writeU64(9);
    w.writeU64(200);
    w.writeU64(123_456_789_012);
    w.writeEnum(40);
    w.writeBits(32, 0xdeadbeef);
    w.writeBool(true);
    w.zeroPadToByte();
    w.writeBytes(new Uint8Array([7]));
    const r = new JxlBitReader(w.finish());
    expect(r.readBits(3)).toBe(5);
    expect(r.readU32(0, 1, { bits: 4, offset: 2 }, { bits: 6, offset: 18 })).toBe(19);
    expect([r.readU64(), r.readU64(), r.readU64(), r.readU64()]).toEqual([0, 9, 200, 123_456_789_012]);
    expect(r.readEnum()).toBe(40);
    expect(r.readBits(32)).toBe(0xdeadbeef);
    expect(r.readBool()).toBe(true);
    r.zeroPadToByte();
    expect(r.readBits(8)).toBe(7);
    expect(() => w.writeU32(99, 0, 1, 2, 3)).toThrow();
  });
});
