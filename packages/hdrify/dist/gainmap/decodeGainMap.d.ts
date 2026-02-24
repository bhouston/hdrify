/**
 * Decode an in-memory gain map encoding result back to HDR HdrifyImage.
 * Use this to test the encode/decode pipeline without JPEG (no compression loss).
 */
import type { HdrifyImage } from '../hdrifyImage.js';
import { type DecodeGainMapOptions } from './readJpegGainMap/decodeGainMapCpu.js';
import type { EncodingResult, EncodingResultFloat } from './types.js';
export type { DecodeGainMapOptions } from './readJpegGainMap/decodeGainMapCpu.js';
/**
 * Decode SDR + gain map (from an EncodingResult) into linear HDR HdrifyImage.
 * Does not involve JPEG; use for round-trip tests and when you already have
 * in-memory SDR and gain map buffers.
 */
export declare function decodeGainMap(encodingResult: EncodingResult, options?: DecodeGainMapOptions): HdrifyImage;
/**
 * Decode from float encoding (no quantization). For testing and incremental pipeline.
 */
export declare function decodeGainMapFromFloatEncoding(encoding: EncodingResultFloat, options?: DecodeGainMapOptions): HdrifyImage;
