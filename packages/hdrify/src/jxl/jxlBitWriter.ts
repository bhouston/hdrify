import type { U32Dist } from './jxlBitReader.js';

/** LSB-first bit writer, the inverse of {@link JxlBitReader}. */
export class JxlBitWriter {
  private bytes = new Uint8Array(1024);
  private bytePos = 0;
  private acc = 0;
  private accBits = 0;

  get bitPosition(): number {
    return this.bytePos * 8 + this.accBits;
  }

  private reserve(required: number): void {
    if (required <= this.bytes.length) return;
    const grown = new Uint8Array(Math.max(this.bytes.length * 2, required));
    grown.set(this.bytes.subarray(0, this.bytePos));
    this.bytes = grown;
  }

  private push(byte: number): void {
    if (this.bytePos === this.bytes.length) this.reserve(this.bytePos + 1);
    this.bytes[this.bytePos++] = byte;
  }

  /** Write the low `n` bits (0 ≤ n ≤ 32) of `value`. */
  writeBits(n: number, value: number): void {
    if (n > 24) {
      this.writeBits(16, value % 0x10000);
      this.writeBits(n - 16, Math.floor(value / 0x10000));
      return;
    }
    if (n === 0) return;
    this.acc |= (value & ((1 << n) - 1)) << this.accBits;
    this.accBits += n;
    while (this.accBits >= 8) {
      this.push(this.acc & 0xff);
      this.acc >>>= 8;
      this.accBits -= 8;
    }
  }

  writeBool(b: boolean): void {
    this.writeBits(1, b ? 1 : 0);
  }

  /** Write `value` with the first U32 distribution that can represent it. */
  writeU32(value: number, d0: U32Dist, d1: U32Dist, d2: U32Dist, d3: U32Dist): void {
    const dists = [d0, d1, d2, d3];
    for (let sel = 0; sel < 4; sel++) {
      const d = dists[sel]!;
      if (typeof d === 'number') {
        if (d === value) {
          this.writeBits(2, sel);
          return;
        }
      } else {
        const v = value - (d.offset ?? 0);
        if (v >= 0 && v < 2 ** d.bits) {
          this.writeBits(2, sel);
          this.writeBits(d.bits, v);
          return;
        }
      }
    }
    throw new Error(`JXL: value ${value} not representable in U32 field`);
  }

  writeU64(value: number): void {
    if (value === 0) this.writeBits(2, 0);
    else if (value <= 16) {
      this.writeBits(2, 1);
      this.writeBits(4, value - 1);
    } else if (value <= 272) {
      this.writeBits(2, 2);
      this.writeBits(8, value - 17);
    } else {
      this.writeBits(2, 3);
      this.writeBits(12, value % 4096);
      let rest = Math.floor(value / 4096);
      let shift = 12;
      while (rest > 0) {
        this.writeBool(true);
        if (shift === 60) {
          this.writeBits(4, rest);
          return;
        }
        this.writeBits(8, rest % 256);
        rest = Math.floor(rest / 256);
        shift += 8;
      }
      this.writeBool(false);
    }
  }

  writeEnum(value: number): void {
    this.writeU32(value, 0, 1, { bits: 4, offset: 2 }, { bits: 6, offset: 18 });
  }

  zeroPadToByte(): void {
    if (this.accBits > 0) this.writeBits(8 - this.accBits, 0);
  }

  /** Append whole bytes; the writer must be byte-aligned. */
  writeBytes(data: Uint8Array): void {
    if (this.accBits !== 0) throw new Error('JXL: writer not byte-aligned');
    this.reserve(this.bytePos + data.length);
    this.bytes.set(data, this.bytePos);
    this.bytePos += data.length;
  }

  /** Bytes written so far, zero-padding a partial final byte. */
  finish(): Uint8Array {
    // slice() would clamp to capacity and lose a pending byte when the buffer is full.
    const out = new Uint8Array(this.bytePos + (this.accBits > 0 ? 1 : 0));
    out.set(this.bytes.subarray(0, this.bytePos));
    if (this.accBits > 0) out[this.bytePos] = this.acc & 0xff;
    return out;
  }
}
