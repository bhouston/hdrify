/**
 * JPEG XL file format container (ISO/IEC 18181-2): ISOBMFF-style boxes wrapping the codestream.
 * Reference: libjxl lib/jxl/decode.cc (box handling), jxl-oxide crates/jxl-bitstream/src/container.
 */

export interface JxlBox {
  type: string;
  data: Uint8Array;
}

export interface JxlExtracted {
  /** The bare codestream (starts with 0xFF 0x0A). */
  codestream: Uint8Array;
  /** Non-codestream boxes (everything except `JXL `, `ftyp`, `jxlc`, `jxlp`), e.g. `Exif`, `xml `, `brob`, `jbrd`. */
  boxes: JxlBox[];
  isContainer: boolean;
}

const CONTAINER_SIGNATURE = [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a];

function hasPrefix(data: Uint8Array, prefix: readonly number[]): boolean {
  return data.length >= prefix.length && prefix.every((b, i) => data[i] === b);
}

/** True if `data` starts with a bare JPEG XL codestream or the container signature box. */
export function isJxl(data: Uint8Array): boolean {
  return hasPrefix(data, [0xff, 0x0a]) || hasPrefix(data, CONTAINER_SIGNATURE);
}

function boxType(data: Uint8Array, pos: number): string {
  return String.fromCharCode(data[pos]!, data[pos + 1]!, data[pos + 2]!, data[pos + 3]!);
}

/**
 * Return the codestream of a bare stream or container. Container `jxlc` boxes are used directly;
 * `jxlp` boxes (4-byte big-endian index, high bit set on the last part) are concatenated in order.
 */
export function extractCodestream(data: Uint8Array): JxlExtracted {
  if (hasPrefix(data, [0xff, 0x0a])) return { codestream: data, boxes: [], isContainer: false };
  if (!hasPrefix(data, CONTAINER_SIGNATURE)) throw new Error('JXL: not a JPEG XL file');

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const boxes: JxlBox[] = [];
  const parts: Uint8Array[] = [];
  let jxlc: Uint8Array | undefined;
  let nextPartIndex = 0;
  let sawLastPart = false;
  let pos = 0;
  while (pos < data.length) {
    if (pos + 8 > data.length) throw new Error('JXL: truncated box header');
    let size = view.getUint32(pos);
    const type = boxType(data, pos + 4);
    let headerSize = 8;
    if (size === 1) {
      if (pos + 16 > data.length) throw new Error('JXL: truncated box header');
      size = Number(view.getBigUint64(pos + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = data.length - pos; // box extends to end of file
    }
    if (size < headerSize || pos + size > data.length) throw new Error(`JXL: invalid size for box '${type}'`);
    const body = data.subarray(pos + headerSize, pos + size);
    pos += size;

    if (type === 'jxlc') {
      if (jxlc || parts.length) throw new Error('JXL: multiple codestream boxes');
      jxlc = body;
    } else if (type === 'jxlp') {
      if (jxlc || sawLastPart) throw new Error('JXL: unexpected jxlp box');
      if (body.length < 4) throw new Error('JXL: truncated jxlp box');
      const index = view.getUint32(body.byteOffset - data.byteOffset);
      if ((index & 0x7fffffff) !== nextPartIndex++) throw new Error('JXL: jxlp boxes out of order');
      sawLastPart = (index & 0x80000000) !== 0;
      parts.push(body.subarray(4));
    } else if (type !== 'JXL ' && type !== 'ftyp') {
      boxes.push({ type, data: body });
    }
  }

  let codestream = jxlc;
  if (!codestream) {
    if (!parts.length) throw new Error('JXL: container has no codestream box');
    codestream = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) {
      codestream.set(p, off);
      off += p.length;
    }
  }
  return { codestream, boxes, isContainer: true };
}

/** EXIF and XMP metadata carried by container boxes. */
export interface JxlBoxMetadata {
  /** Raw TIFF-structured EXIF bytes (starting `II*\0` or `MM\0*`), without the box's 4-byte offset prefix. */
  exif?: Uint8Array;
  /** XMP packet decoded as UTF-8. */
  xmp?: string;
}

type BrotliDecompress = (data: Uint8Array) => Uint8Array;

/** Largest decompressed `brob` payload accepted (64 MiB), bounding Brotli expansion of crafted boxes. */
const MAX_BROB_OUTPUT = 1 << 26;

/**
 * Synchronous Brotli decoder from Node's zlib, looked up without a static import so browser bundles
 * never reference `node:zlib`. Undefined outside Node (browsers only offer asynchronous streams).
 */
function nodeBrotliDecompress(): BrotliDecompress | undefined {
  type ZlibModule = { brotliDecompressSync?: (data: Uint8Array, opts: { maxOutputLength: number }) => Uint8Array };
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: 'node:zlib') => ZlibModule | undefined } }).process;
  const decompress = proc?.getBuiltinModule?.('node:zlib')?.brotliDecompressSync;
  return decompress && ((data) => decompress(data, { maxOutputLength: MAX_BROB_OUTPUT }));
}

/**
 * Collect EXIF (`Exif`) and XMP (`xml `) metadata from container boxes, using the first box of each kind.
 * Brotli-compressed `brob` boxes wrapping `Exif` or `xml ` are decompressed with Node's
 * `zlib.brotliDecompressSync`; where that is unavailable (browsers), `brob` boxes are skipped.
 * Invalid metadata never fails the image decode: a `brob` box that is corrupt or would decompress
 * past 64 MiB (the decoder throws) is skipped, and an `Exif` box whose TIFF header offset points
 * outside the box is ignored.
 *
 * @param boxes - Non-codestream boxes from {@link extractCodestream}.
 * @param brotliDecompress - Brotli decoder for `brob` boxes (default: Node zlib when available; `null` skips them).
 * @returns The metadata found; fields are absent when the file carries none.
 */
export function readJxlBoxMetadata(
  boxes: readonly JxlBox[],
  brotliDecompress: BrotliDecompress | null | undefined = nodeBrotliDecompress(),
): JxlBoxMetadata {
  const out: JxlBoxMetadata = {};
  for (let { type, data } of boxes) {
    if (type === 'brob') {
      if (data.length < 4 || !brotliDecompress) continue;
      type = boxType(data, 0);
      if (type !== 'Exif' && type !== 'xml ') continue;
      try {
        data = new Uint8Array(brotliDecompress(data.subarray(4)));
      } catch {
        continue; // corrupt or oversize (maxOutputLength) brob box
      }
    }
    if (type === 'Exif' && !out.exif && data.length >= 4) {
      const offset = new DataView(data.buffer, data.byteOffset, 4).getUint32(0);
      if (offset <= data.length - 4) out.exif = data.slice(4 + offset);
    } else if (type === 'xml ' && out.xmp === undefined) {
      out.xmp = new TextDecoder().decode(data);
    }
  }
  return out;
}
