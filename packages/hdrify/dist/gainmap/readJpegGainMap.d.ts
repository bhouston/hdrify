/**
 * Read JPEG with embedded gain map (JPEG-R / Ultra HDR) into HdrifyImage.
 * Throws if the buffer does not contain valid gain map metadata or both SDR and gain map images.
 */
import './ensureBuffer.js';
import { type HdrifyImage } from '../hdrifyImage.js';
export type GainMapFormat = 'ultrahdr' | 'adobe-gainmap';
/**
 * Read a JPEG buffer that contains embedded gain map (XMP + MPF) and return
 * decoded HDR as HdrifyImage. Supports UltraHDR/JPEG-R layout.
 *
 * @param buffer - Full JPEG-R file bytes
 * @returns HdrifyImage with linear HDR RGBA; metadata.format is 'ultrahdr' or 'adobe-gainmap'
 * @throws If no gain map XMP is found, or if primary/gain map images cannot be extracted
 */
export declare function readJpegGainMap(buffer: Uint8Array): HdrifyImage;
