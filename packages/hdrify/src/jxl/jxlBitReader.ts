/**
 * LSB-first bit reader for JPEG XL codestreams (ISO/IEC 18181-1, section 9 / Annex B field encodings).
 * Bits are consumed from the least significant end of each byte, bytes in increasing order.
 * Reference: libjxl lib/jxl/dec_bit_reader.h, jxl-oxide crates/jxl-bitstream/src/bitstream.rs.
 */

/** One U32 distribution: a constant value, or `offset + u(bits)`. */
export type U32Dist = number | { bits: number; offset?: number };

export class JxlBitReader {
  private readonly bytes: Uint8Array;
  private bytePos: number;
  /** Buffered bits, LSB first; holds `bufBits` valid bits (≤ 32). */
  private buf = 0;
  private bufBits = 0;
  private readonly endByte: number;

  constructor(bytes: Uint8Array, byteOffset = 0, byteLength = bytes.length - byteOffset) {
    if (
      !Number.isInteger(byteOffset) ||
      !Number.isInteger(byteLength) ||
      byteOffset < 0 ||
      byteLength < 0 ||
      byteOffset > bytes.length ||
      byteLength > bytes.length - byteOffset
    )
      throw new Error('JXL: invalid bit-reader range');
    this.bytes = bytes;
    this.bytePos = byteOffset;
    this.endByte = byteOffset + byteLength;
  }

  /** Validate consumed bits after a header/section; unconsumed entropy lookahead may cross EOF. */
  checkBounds(): void {
    if (this.bitPosition > this.bitLength) throw new Error('JXL: unexpected end of bitstream');
  }

  /** Bits consumed since the start of the underlying byte array. */
  get bitPosition(): number {
    return this.bytePos * 8 - this.bufBits;
  }

  /** Total bits available from the start of the underlying byte array to the end of this reader's range. */
  get bitLength(): number {
    return this.endByte * 8;
  }

  private refill(): void {
    while (this.bufBits <= 24) {
      if (this.bytePos >= this.endByte) {
        // Past the end: the spec treats this as a malformed stream. Tolerate up to 64 virtual zero bits
        // (entropy decoders may peek ahead), then fail.
        if (this.bytePos >= this.endByte + 8) throw new Error('JXL: unexpected end of bitstream');
        this.bytePos++;
        this.bufBits += 8;
        continue;
      }
      this.buf |= this.bytes[this.bytePos++]! << this.bufBits;
      this.bufBits += 8;
    }
  }

  /** Read `n` bits (0 ≤ n ≤ 32) as an unsigned integer. */
  readBits(n: number): number {
    if (n === 0) return 0;
    if (n > 24) {
      const lo = this.readBits(16);
      return lo + this.readBits(n - 16) * 0x10000;
    }
    if (this.bufBits < n) this.refill();
    const v = this.buf & ((1 << n) - 1);
    this.buf >>>= n;
    this.bufBits -= n;
    return v;
  }

  /** Peek `n` bits (n ≤ 24) without consuming them. */
  peekBits(n: number): number {
    if (this.bufBits < n) this.refill();
    return this.buf & ((1 << n) - 1);
  }

  /** Consume `n` bits (n ≤ 24) previously peeked. */
  skipBits(n: number): void {
    if (this.bufBits < n) this.refill();
    this.buf >>>= n;
    this.bufBits -= n;
  }

  readBool(): boolean {
    return this.readBits(1) === 1;
  }

  /** U32(d0, d1, d2, d3): 2-bit selector picks one of four distributions. */
  readU32(d0: U32Dist, d1: U32Dist, d2: U32Dist, d3: U32Dist): number {
    const sel = this.readBits(2);
    const d = sel === 0 ? d0 : sel === 1 ? d1 : sel === 2 ? d2 : d3;
    if (typeof d === 'number') return d;
    return (d.offset ?? 0) + this.readBits(d.bits);
  }

  /** U64 field (values above 2^53 lose precision; never seen in practice). */
  readU64(): number {
    const sel = this.readBits(2);
    if (sel === 0) return 0;
    if (sel === 1) return 1 + this.readBits(4);
    if (sel === 2) return 17 + this.readBits(8);
    let value = this.readBits(12);
    let shift = 12;
    while (this.readBool()) {
      if (shift === 60) {
        value += this.readBits(4) * 2 ** shift;
        break;
      }
      value += this.readBits(8) * 2 ** shift;
      shift += 8;
    }
    return value;
  }

  /** F16 field: IEEE 754 binary16, must be finite. */
  readF16(): number {
    const bits = this.readBits(16);
    const sign = bits >> 15 ? -1 : 1;
    const exp = (bits >> 10) & 0x1f;
    const mant = bits & 0x3ff;
    if (exp === 31) throw new Error('JXL: non-finite F16 value');
    if (exp === 0) return sign * mant * 2 ** -24;
    return sign * (1 + mant / 1024) * 2 ** (exp - 15);
  }

  /** Enum field: U32(Val(0), Val(1), BitsOffset(4, 2), BitsOffset(6, 18)). */
  readEnum(): number {
    const v = this.readU32(0, 1, { bits: 4, offset: 2 }, { bits: 6, offset: 18 });
    if (v > 63) throw new Error('JXL: enum value out of range');
    return v;
  }

  /** Skip to the next byte boundary; the skipped bits must be zero. */
  zeroPadToByte(): void {
    const pad = (8 - (this.bitPosition % 8)) % 8;
    if (pad && this.readBits(pad) !== 0) throw new Error('JXL: non-zero padding bits');
  }

  /** Skip `n` bits (any count). */
  skip(n: number): void {
    while (n > 24) {
      this.readBits(24);
      n -= 24;
    }
    this.readBits(n);
  }

  /** Byte offset of the reader; only valid at a byte boundary. */
  get byteOffset(): number {
    const pos = this.bitPosition;
    if (pos % 8 !== 0) throw new Error('JXL: reader not byte-aligned');
    return pos / 8;
  }
}

/** Unpack a signed integer from its zig-zag unsigned representation (spec: UnpackSigned). */
export function unpackSigned(u: number): number {
  return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
}
