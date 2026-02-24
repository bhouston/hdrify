import { type HdrifyImage } from '../hdrifyImage.js';
import type { EncodingResult, EncodingResultFloat, GainMapEncodingOptions } from './types.js';
/**
 * Encode HDR image to SDR + gain map (pure TypeScript, no WebGL).
 */
export declare function encodeGainMap(image: HdrifyImage, options?: GainMapEncodingOptions): EncodingResult;
/**
 * Encode to float buffers only (no quantization). For testing and incremental pipeline.
 * Decode is tone-map-agnostic: the gain map stores the ratio HDR_linear/SDR_linear.
 */
export declare function encodeGainMapToFloat(image: HdrifyImage, options?: GainMapEncodingOptions): EncodingResultFloat;
