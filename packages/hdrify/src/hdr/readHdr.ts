import type { FloatImageData } from '../floatImage.js';
import { applyToneMapping } from '../tonemapping/applyToneMapping.js';
import type { ToneMappingType } from '../tonemapping/types.js';

export interface HDRToLDROptions {
  /** Tone mapping: 'aces' or 'reinhard' (default: 'reinhard') */
  toneMapping?: ToneMappingType;
  /** Exposure value for tone mapping (default: 1.0) */
  exposure?: number;
  /** Gamma value for gamma correction (default: 2.2 for reinhard, 1 for aces) */
  gamma?: number;
}

export interface ParseHDROptions {
  /** When true (default), require exact #?RADIANCE magic token. When false, accept any #?<programtype> */
  headerStrict?: boolean;
  /** 'raw' (default): return pixel values as stored. 'physicalRadiance': divide by EXPOSURE for physical radiance */
  output?: 'raw' | 'physicalRadiance';
}

/**
 * Read an HDR (Radiance) file buffer and return image data
 *
 * Implementation based on Three.js HDRLoader, adapted from:
 * http://www.graphics.cornell.edu/~bjw/rgbe.html
 *
 * @param hdrBuffer - Uint8Array containing HDR file data
 * @param options - Parse options (headerStrict, output)
 * @returns Parsed HDR image data with dimensions and pixel data as FloatImageData
 */
export function readHdr(hdrBuffer: Uint8Array, options: ParseHDROptions = {}): FloatImageData {
  const { headerStrict = true, output = 'raw' } = options;

  // Use Uint8Array for processing
  const byteArray = hdrBuffer;
  const offsetRef = { offset: 0 };

  const header = RGBE_ReadHeader(byteArray, offsetRef, { headerStrict });

  const w = header.width;
  const h = header.height;

  // Header reading already consumed the blank line after dimensions
  // offsetRef.offset now points to the start of pixel data
  const image_rgba_data = RGBE_ReadPixels_RLE(byteArray.subarray(offsetRef.offset), w, h);

  // Convert RGBE bytes to Float32Array RGBA
  const numElements = image_rgba_data.length / 4;
  const floatArray = new Float32Array(numElements * 4);

  for (let j = 0; j < numElements; j++) {
    RGBEByteToRGBFloat(image_rgba_data, j * 4, floatArray, j * 4);
  }

  // Apply physicalRadiance: divide by exposure product
  // biome-ignore lint/security/noSecrets: not a secret
  if (output === 'physicalRadiance' && header.exposure !== 1.0) {
    const scale = 1 / header.exposure;
    for (let i = 0; i < floatArray.length; i++) {
      if (i % 4 !== 3) {
        // Don't scale alpha
        (floatArray as Float32Array)[i] = (floatArray[i] ?? 0) * scale;
      }
    }
  }

  return {
    width: w,
    height: h,
    data: floatArray,
    metadata: header.metadata,
  };
}

/**
 * Convert RGBE byte data to RGB float values
 */
function RGBEByteToRGBFloat(
  sourceArray: Uint8Array,
  sourceOffset: number,
  destArray: Float32Array,
  destOffset: number,
): void {
  const e = sourceArray[sourceOffset + 3] ?? 128;
  const scale = 2.0 ** (e - 128.0) / 255.0;

  destArray[destOffset + 0] = (sourceArray[sourceOffset + 0] ?? 0) * scale;
  destArray[destOffset + 1] = (sourceArray[sourceOffset + 1] ?? 0) * scale;
  destArray[destOffset + 2] = (sourceArray[sourceOffset + 2] ?? 0) * scale;
  destArray[destOffset + 3] = 1;
}

const magic_token_re = /^#\?(\S+)/;
//const gamma_re = /^\s*GAMMA\s*=\s*([\d.]+)\s*$/;
//const exposure_re = /^\s*EXPOSURE\s*=\s*([\d.]+)\s*$/;
//const format_re = /^\s*FORMAT=(\S+)\s*$/;
//const supported_resolution_re = /^\s*-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/;
// Match any Radiance resolution string: [+-][XY] N [+-][XY] M
const resolution_re = /^\s*([-+])([XY])\s+(\d+)\s+([-+])([XY])\s+(\d+)\s*$/;
const var_assign_re = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/**
 * Read HDR header information
 */
function RGBE_ReadHeader(
  buffer: Uint8Array,
  offsetRef: { offset: number },
  opts: { headerStrict: boolean },
): {
  valid: number;
  string: string;
  comments: string;
  programtype: string;
  format: string;
  gamma: number;
  exposure: number;
  width: number;
  height: number;
  metadata: Record<string, unknown>;
} {
  const RGBE_VALID_PROGRAMTYPE = 1;
  const RGBE_VALID_FORMAT = 2;
  const RGBE_VALID_DIMENSIONS = 4;

  const NEWLINE = '\n';

  const metadata: Record<string, unknown> = {};
  const header = {
    valid: 0,
    string: '',
    comments: '',
    programtype: 'RGBE',
    format: '',
    gamma: 1.0,
    exposure: 1.0,
    width: 0,
    height: 0,
    metadata,
  };

  function fgets(): string | false {
    const lineLimit = 1024;
    let p = offsetRef.offset;

    if (p >= buffer.byteLength) {
      return false;
    }

    const endPos = Math.min(p + lineLimit, buffer.byteLength);
    let s = '';

    // Read until we find a newline or reach the limit
    while (p < endPos) {
      const byte = buffer[p];
      if (byte === undefined) {
        break;
      }
      if (byte === NEWLINE.charCodeAt(0)) {
        offsetRef.offset = p + 1;
        return s;
      }
      s += String.fromCharCode(byte);
      p++;
    }

    // No newline found, consume what we read
    offsetRef.offset = p;
    return s.length > 0 ? s : false;
  }

  function rgbe_error(rgbe_error_code: number, msg?: string): never {
    const rgbe_read_error = 1;
    const rgbe_write_error = 2;
    const rgbe_format_error = 3;
    const rgbe_memory_error = 4;

    switch (rgbe_error_code) {
      case rgbe_read_error:
        throw new Error(`HDR Read Error: ${msg || ''}`);
      case rgbe_write_error:
        throw new Error(`HDR Write Error: ${msg || ''}`);
      case rgbe_format_error:
        throw new Error(`HDR Bad File Format: ${msg || ''}`);
      case rgbe_memory_error:
        throw new Error(`HDR Memory Error: ${msg || ''}`);
      default:
        throw new Error(`HDR Memory Error: ${msg || ''}`);
    }
  }

  function parseMetadataValue(val: string): number | string {
    const trimmed = val.trim();
    const num = parseFloat(trimmed);
    if (!Number.isNaN(num) && trimmed === String(num)) {
      return num;
    }
    return trimmed;
  }

  if (offsetRef.offset >= buffer.byteLength) {
    rgbe_error(1, 'no header found');
  }

  let line = fgets();
  if (line === false) {
    rgbe_error(3, 'no header found');
  }

  const match = line.match(magic_token_re);
  if (!match || !match[1]) {
    rgbe_error(3, 'bad initial token');
  }

  if (opts.headerStrict && match[1] !== 'RADIANCE') {
    rgbe_error(3, `expected #?RADIANCE, got #?${match[1]}`);
  }

  header.valid |= RGBE_VALID_PROGRAMTYPE;
  header.programtype = match[1];
  header.string += line + '\n';

  // biome-ignore lint/nursery/noUnnecessaryConditions: loop breaks when line is false
  while (true) {
    line = fgets();
    if (false === line) break;
    header.string += line + '\n';

    if ('#' === line.charAt(0)) {
      header.comments += line + '\n';
      continue; // comment line
    }

    // Variable assignment (e.g. FORMAT=..., EXPOSURE=..., GAMMA=...)
    const varMatch = line.match(var_assign_re);
    if (varMatch?.[1]) {
      const key = varMatch[1];
      const val = parseMetadataValue(varMatch[2] ?? '');
      metadata[key] = val;

      if (key === 'GAMMA' && typeof val === 'number') {
        header.gamma = val;
      } else if (key === 'EXPOSURE' && typeof val === 'number') {
        header.exposure *= val; // Cumulative per spec
        metadata[key] = header.exposure; // Store cumulative product
      } else if (key === 'FORMAT') {
        header.valid |= RGBE_VALID_FORMAT;
        header.format = String(val);
        if (header.format === '32-bit_rle_xyze') {
          rgbe_error(3, 'XYZ format is not supported; only RGBE format is supported');
        }
      }
      continue;
    }

    // Resolution string
    const resMatch = line.match(resolution_re);
    if (resMatch) {
      const sign1 = resMatch[1];
      const axis1 = resMatch[2];
      const num1 = resMatch[3];
      const sign2 = resMatch[4];
      const axis2 = resMatch[5];
      const num2 = resMatch[6];

      if (axis1 === 'Y' && sign1 === '-' && axis2 === 'X' && sign2 === '+') {
        header.valid |= RGBE_VALID_DIMENSIONS;
        header.height = parseInt(num1 ?? '0', 10);
        header.width = parseInt(num2 ?? '0', 10);
        metadata['RESOLUTION'] = line.trim();
        break;
      }

      throw new Error(
        `Unsupported resolution format: ${line.trim()}. Only -Y N +X M (standard orientation) is supported.`,
      );
    }
  }

  if (!(header.valid & RGBE_VALID_FORMAT)) {
    rgbe_error(3, 'missing format specifier');
  }

  if (!(header.valid & RGBE_VALID_DIMENSIONS)) {
    rgbe_error(3, 'missing image size specifier');
  }

  if (header.width === 0 || header.height === 0) {
    rgbe_error(3, 'invalid image dimensions');
  }

  return header;
}

/** Old RLE: illegal pixel has R=G=B=255, exponent = repeat count */
function isOldRLEPixel(buf: Uint8Array, offset: number): boolean {
  // biome-ignore lint/style/noNonNullAssertion: safe read from buf
  return buf[offset]! === 255 && buf[offset + 1]! === 255 && buf[offset + 2]! === 255;
}

function hasOldRLE(buffer: Uint8Array): boolean {
  for (let i = 0; i < buffer.length; i += 4) {
    if (i + 4 <= buffer.length && isOldRLEPixel(buffer, i)) {
      return true;
    }
  }
  return false;
}

/** Decode old Radiance RLE: (255,255,255,E) = repeat previous pixel E times; consecutive indicators add higher-order bytes */
function decodeOldRLE(buffer: Uint8Array, w: number, h: number): Uint8Array {
  const output = new Uint8Array(4 * w * h);
  let outIdx = 0;
  let pos = 0;
  const prev = new Uint8Array(4);

  while (outIdx < output.length && pos < buffer.length) {
    if (pos + 4 > buffer.length) {
      throw new Error('HDR Bad File Format: truncated old RLE data');
    }

    // biome-ignore lint/style/noNonNullAssertion: safe read from buffer
    const r = buffer[pos++]!;
    // biome-ignore lint/style/noNonNullAssertion: safe read from buffer
    const g = buffer[pos++]!;
    // biome-ignore lint/style/noNonNullAssertion: safe read from buffer
    const b = buffer[pos++]!;
    // biome-ignore lint/style/noNonNullAssertion: safe read from buffer
    const e = buffer[pos++]!;

    if (r === 255 && g === 255 && b === 255) {
      // Repeat indicator: output previous pixel E times; consecutive indicators add higher-order bytes
      let count = e;
      let shift = 1;
      while (pos + 4 <= buffer.length) {
        // biome-ignore lint/style/noNonNullAssertion: safe read from buffer
        const r2 = buffer[pos]!;
        // biome-ignore lint/style/noNonNullAssertion: safe read from buffer
        const g2 = buffer[pos + 1]!;
        // biome-ignore lint/style/noNonNullAssertion: safe read from buffer
        const b2 = buffer[pos + 2]!;
        // biome-ignore lint/style/noNonNullAssertion: safe read from buffer
        const e2 = buffer[pos + 3]!;
        if (r2 !== 255 || g2 !== 255 || b2 !== 255) break;
        pos += 4;
        count += e2 << (8 * shift);
        shift++;
      }
      for (let i = 0; i < count && outIdx < output.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: safe read from prev
        output[outIdx++] = prev[0]!;
        // biome-ignore lint/style/noNonNullAssertion: safe read from prev
        output[outIdx++] = prev[1]!;
        // biome-ignore lint/style/noNonNullAssertion: safe read from prev
        output[outIdx++] = prev[2]!;
        // biome-ignore lint/style/noNonNullAssertion: safe read from prev
        output[outIdx++] = prev[3]!;
      }
    } else {
      const rn = (r & 0xff) as number;
      const gn = (g & 0xff) as number;
      const bn = (b & 0xff) as number;
      const en = (e & 0xff) as number;
      prev[0] = rn;
      prev[1] = gn;
      prev[2] = bn;
      prev[3] = en;
      output[outIdx++] = rn;
      output[outIdx++] = gn;
      output[outIdx++] = bn;
      output[outIdx++] = en;
    }
  }

  if (outIdx !== output.length) {
    throw new Error('HDR Bad File Format: old RLE did not produce expected pixel count');
  }
  return output;
}

/**
 * Read RLE-compressed pixel data
 */
function RGBE_ReadPixels_RLE(buffer: Uint8Array, w: number, h: number): Uint8Array {
  const scanline_width = w;

  // Strip leading newlines (blank line after resolution string)
  let pixelBuffer = buffer;
  while (pixelBuffer.length > 0 && pixelBuffer[0] === 0x0a) {
    pixelBuffer = pixelBuffer.subarray(1);
  }

  if (
    // run length encoding is not allowed so read flat
    scanline_width < 8 ||
    scanline_width > 0x7fff ||
    // this file is not run length encoded
    pixelBuffer.length < 4 ||
    pixelBuffer[0] !== 2 ||
    pixelBuffer[1] !== 2 ||
    // biome-ignore lint/style/noNonNullAssertion: safe read from pixelBuffer
    pixelBuffer[2]! & 0x80
  ) {
    // Flat path: uncompressed or old RLE
    const expected = 4 * w * h;
    if (pixelBuffer.length < expected && hasOldRLE(pixelBuffer)) {
      return decodeOldRLE(pixelBuffer, w, h);
    }
    if (pixelBuffer.length === expected + 1 && pixelBuffer[0] === 0x0a) {
      pixelBuffer = pixelBuffer.subarray(1);
    }
    if (pixelBuffer.length !== expected) {
      throw new Error(`HDR Bad File Format: expected ${expected} bytes (${w}x${h}), got ${pixelBuffer.length}`);
    }
    return new Uint8Array(pixelBuffer);
  }

  // biome-ignore lint/style/noNonNullAssertion: safe read from pixelBuffer
  const bufferWidth = (pixelBuffer[2]! << 8) | pixelBuffer[3]!;
  if (scanline_width !== bufferWidth) {
    throw new Error(`HDR Bad File Format: wrong scanline width (expected ${scanline_width}, got ${bufferWidth})`);
  }

  const data_rgba = new Uint8Array(4 * w * h);

  if (!data_rgba.length) {
    throw new Error('HDR Memory Error: unable to allocate buffer space');
  }

  let outputOffset = 0;
  let pos = 0; // First scanline header is at 0 (already validated by condition above)

  const ptr_end = 4 * scanline_width;
  const rgbeStart = new Uint8Array(4);
  const scanline_buffer = new Uint8Array(ptr_end);
  let num_scanlines = h;

  // read in each successive scanline
  while (num_scanlines > 0 && pos < pixelBuffer.byteLength) {
    if (pos + 4 > pixelBuffer.byteLength) {
      throw new Error('HDR Read Error');
    }

    // biome-ignore lint/style/noNonNullAssertion: safe read from pixelBuffer
    rgbeStart[0] = pixelBuffer[pos++]!;
    // biome-ignore lint/style/noNonNullAssertion: safe read from pixelBuffer
    rgbeStart[1] = pixelBuffer[pos++]!;
    // biome-ignore lint/style/noNonNullAssertion: safe read from pixelBuffer
    rgbeStart[2] = pixelBuffer[pos++]!;
    // biome-ignore lint/style/noNonNullAssertion: safe read from pixelBuffer
    rgbeStart[3] = pixelBuffer[pos++]!;

    if (rgbeStart[0] !== 2 || rgbeStart[1] !== 2 || ((rgbeStart[2] << 8) | rgbeStart[3]) !== scanline_width) {
      throw new Error('HDR Bad File Format: bad rgbe scanline format');
    }

    // read each of the four channels for the scanline into the buffer
    // first red, then green, then blue, then exponent
    let ptr = 0;
    let count: number;

    while (ptr < ptr_end && pos < pixelBuffer.byteLength) {
      const countByte = pixelBuffer[pos++];
      if (countByte === undefined) {
        throw new Error('HDR Read Error: unexpected end of data');
      }
      count = countByte;
      const isEncodedRun = count > 128;
      if (isEncodedRun) count -= 128;

      if (count === 0 || ptr + count > ptr_end) {
        throw new Error('HDR Bad File Format: bad scanline data');
      }

      if (isEncodedRun) {
        // a (encoded) run of the same value
        const byteValue = pixelBuffer[pos++];
        if (byteValue === undefined) {
          throw new Error('HDR Read Error: unexpected end of data');
        }
        for (let i = 0; i < count; i++) {
          scanline_buffer[ptr++] = byteValue;
        }
      } else {
        // a literal-run: copy count bytes from buffer
        scanline_buffer.set(pixelBuffer.subarray(pos, pos + count), ptr);
        ptr += count;
        pos += count;
      }
    }

    // now convert data from buffer into rgba
    // first red, then green, then blue, then exponent (alpha)
    const l = scanline_width;
    for (let i = 0; i < l; i++) {
      let off = 0;
      // biome-ignore lint/style/noNonNullAssertion: safe read
      data_rgba[outputOffset] = scanline_buffer[i + off]!;
      off += scanline_width;
      // biome-ignore lint/style/noNonNullAssertion: safe read
      data_rgba[outputOffset + 1] = scanline_buffer[i + off]!;
      off += scanline_width;
      // biome-ignore lint/style/noNonNullAssertion: safe read
      data_rgba[outputOffset + 2] = scanline_buffer[i + off]!;
      off += scanline_width;
      // biome-ignore lint/style/noNonNullAssertion: safe read
      data_rgba[outputOffset + 3] = scanline_buffer[i + off]!;
      outputOffset += 4;
    }

    num_scanlines--;
  }

  return data_rgba;
}

/**
 * Convert HDR float data to LDR (Low Dynamic Range) uint8 data using tone mapping
 *
 * Uses unified tone mapping (Reinhard or ACES) with gamma correction to convert
 * high dynamic range floating point values to standard 8-bit RGB values.
 *
 * @param hdrData - Float32Array of RGBA pixel data [R, G, B, A, R, G, B, A, ...] where A is always 1.0
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param options - Tone mapping options (toneMapping, exposure, gamma)
 * @returns Uint8Array containing uint8 RGB data ready for image encoding
 */
export function hdrToLdr(
  hdrData: Float32Array,
  width: number,
  height: number,
  options: HDRToLDROptions = {},
): Uint8Array {
  return applyToneMapping(hdrData, width, height, {
    toneMapping: options.toneMapping ?? 'reinhard',
    exposure: options.exposure ?? 1.0,
    gamma: options.gamma ?? 2.2,
  });
}

/**
 * Convert an HDR file buffer to LDR RGB buffer
 *
 * This is a convenience function that combines parsing and conversion.
 *
 * @param hdrBuffer - Uint8Array containing HDR file data
 * @param options - Tone mapping options (exposure and gamma)
 * @returns Object containing width, height, and LDR RGB buffer
 */
export function convertHDRToLDR(
  hdrBuffer: Uint8Array,
  options: HDRToLDROptions = {},
): { width: number; height: number; ldrData: Uint8Array } {
  const hdrImage = readHdr(hdrBuffer);
  const toneMapping = options.toneMapping ?? 'reinhard';
  const fileGamma = hdrImage.metadata?.GAMMA as number | undefined;
  const fileExposure = hdrImage.metadata?.EXPOSURE as number | undefined;
  const gamma = options.gamma ?? (toneMapping === 'aces' ? 1 : (fileGamma ?? 2.2));
  const ldrData = hdrToLdr(hdrImage.data, hdrImage.width, hdrImage.height, {
    toneMapping,
    exposure: options.exposure ?? fileExposure ?? 1.0,
    gamma,
  });

  return {
    width: hdrImage.width,
    height: hdrImage.height,
    ldrData,
  };
}
