import { type HdrifyImage, isJxl, readExr, readHdr, readJpegGainMap, readJxl } from 'hdrify';

const startsWith = (bytes: Uint8Array, magic: number[]): boolean => magic.every((byte, i) => bytes[i] === byte);

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Decode an OpenEXR, Radiance HDR, JPEG XL or JPEG gain map (Ultra HDR / Adobe) file, detected from its content, not its
 * name. Gzip-compressed files (such as `.hdr.gz`) are decompressed first.
 */
export async function decodeHdrifyImage(input: ArrayBuffer | Uint8Array): Promise<HdrifyImage> {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (startsWith(bytes, [0x1f, 0x8b])) bytes = await gunzip(bytes);
  if (startsWith(bytes, [0x76, 0x2f, 0x31, 0x01])) return readExr(bytes);
  if (startsWith(bytes, [0x23, 0x3f])) return readHdr(bytes); // "#?RADIANCE" / "#?RGBE"
  if (isJxl(bytes)) return readJxl(bytes);
  if (startsWith(bytes, [0xff, 0xd8])) return readJpegGainMap(bytes);
  throw new Error('Unsupported image: expected OpenEXR, Radiance HDR, JPEG XL or a JPEG gain map');
}
