/**
 * CPU decode: apply gain map to SDR to produce HDR Float32 RGBA.
 * Matches UltraHDR/gainmap-js formula: logRecovery, logBoost, weightFactor, offsets.
 *
 * Adobe/Ultra HDR spec: SDR base image is sRGB (display-ready for standard viewers).
 * We linearize before applying gain; the gain formula uses linear light.
 */
import type { HdrifyImage } from '../../hdrifyImage.js';
import type { GainMapMetadata } from '../types.js';
export interface DecodeGainMapOptions {
    /** Maximum display boost for weight factor; default full HDR (weightFactor = 1) */
    maxDisplayBoost?: number;
}
/**
 * Decode SDR + gain map pixels with metadata into linear HDR HdrifyImage.
 * SDR and gainMap can be 0-255 RGBA (Uint8) or 0-1 float (Float32Array). Mixed modes supported.
 */
export declare function decodeGainMapCpu(sdr: Uint8ClampedArray | Uint8Array | Float32Array, gainMap: Uint8ClampedArray | Uint8Array | Float32Array, width: number, height: number, metadata: GainMapMetadata, options?: DecodeGainMapOptions): HdrifyImage;
/**
 * Decode from float SDR and float gain map (no quantization). For testing and incremental pipeline.
 * Same formula as decodeGainMapCpu. sdrFloat is sRGB [0,1] per spec (matches stored base image).
 */
export declare function decodeGainMapFromFloat(sdrFloat: Float32Array, gainMapFloat: Float32Array, width: number, height: number, metadata: GainMapMetadata, options?: DecodeGainMapOptions): HdrifyImage;
