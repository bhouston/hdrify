import { convertFloat32ToLinearColorSpace } from '../../hdrify/src/color/convert.ts';
import { encodeGainMap } from '../../hdrify/src/gainmap/gainMapEncoder.ts';
import { writeJpegGainMap } from '../../hdrify/src/gainmap/writeJpegGainMap.ts';
import { writeJxl } from '../../hdrify/src/jxl/writeJxl.ts';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const result = new Uint8Array(12 + data.length);
  new DataView(result.buffer).setUint32(0, data.length);
  result.set(new TextEncoder().encode(type), 4);
  result.set(data, 8);
  new DataView(result.buffer).setUint32(8 + data.length, crc32(result.subarray(4, 8 + data.length)));
  return result;
}
function pq(nits) {
  const y = (Math.max(0, Math.min(10000, nits)) / 10000) ** (2610 / 16384);
  return ((3424 / 4096 + (2413 / 128) * y) / (1 + (2392 / 128) * y)) ** (2523 / 32);
}

// Experimental 16-bit Rec.2020/PQ PNG. cICP is authoritative where supported;
// the matching logo ICC profile also exercises the older ICC-based decoder path.
export async function encodePqPng(image, referenceWhiteNits = 203) {
  const data = convertFloat32ToLinearColorSpace(
    image.data,
    image.width,
    image.height,
    image.linearColorSpace,
    'linear-rec2020',
  );
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  header[8] = 16;
  header[9] = 6;
  const stride = image.width * 8 + 1;
  const scanlines = new Uint8Array(stride * image.height);
  const samples = new DataView(scanlines.buffer);
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const source = (y * image.width + x) * 4;
      const target = y * stride + 1 + x * 8;
      for (let c = 0; c < 3; c++)
        samples.setUint16(target + c * 2, Math.round(pq(data[source + c] * referenceWhiteNits) * 65535));
      samples.setUint16(target + 6, Math.round(Math.max(0, Math.min(1, data[source + 3])) * 65535));
    }
  const logo = new Uint8Array(await (await fetch('/logo.png')).arrayBuffer());
  let icc;
  for (let offset = 8; offset < logo.length;) {
    const size = new DataView(logo.buffer).getUint32(offset);
    if (new TextDecoder().decode(logo.subarray(offset + 4, offset + 8)) === 'iCCP')
      icc = logo.slice(offset + 8, offset + 8 + size);
    offset += size + 12;
  }
  const compressed = new Uint8Array(
    await new Response(new Blob([scanlines]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer(),
  );
  return new Blob(
    [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('cICP', new Uint8Array([9, 16, 0, 1])),
      ...(icc ? [chunk('iCCP', icc)] : []),
      chunk('IDAT', compressed),
      chunk('IEND', new Uint8Array()),
    ],
    { type: 'image/png' },
  );
}

export async function transcode(image, exposureEV = 0) {
  const data = image.data.slice();
  for (let i = 0; i < data.length; i++) if (i % 4 !== 3) data[i] *= 2 ** exposureEV;
  const exposed = { ...image, data };
  return [
    {
      name: 'Gain-map JPEG',
      blob: new Blob(
        [
          writeJpegGainMap(encodeGainMap({ ...exposed, data: data.slice() }, { toneMapping: 'neutral' }), {
            quality: 100,
          }),
        ],
        { type: 'image/jpeg' },
      ),
    },
    {
      name: 'Float16 JPEG XL',
      blob: new Blob([writeJxl({ ...exposed, data: data.slice() }, { bitDepth: 'float16', container: true })], {
        type: 'image/jxl',
      }),
    },
    { name: '16-bit PQ PNG · 1 = 203 nits', blob: await encodePqPng(exposed) },
  ];
}

export async function displayNative(image, exposureEV, container) {
  const encoded = await transcode(image, exposureEV);
  const results = [];
  for (const item of encoded) {
    const element = document.createElement('img');
    element.alt = item.name;
    element.style.setProperty('dynamic-range-limit', 'no-limit');
    const url = URL.createObjectURL(item.blob);
    element.src = url;
    const result = { name: item.name, bytes: item.blob.size, decoded: false, element };
    try {
      await element.decode();
      result.decoded = true;
      result.width = element.naturalWidth;
      result.height = element.naturalHeight;
    } catch (error) {
      result.error = String(error);
    }
    URL.revokeObjectURL(url);
    const card = document.createElement('section');
    const label = document.createElement('h3');
    label.textContent = `${item.name} · ${item.blob.size} bytes`;
    const status = document.createElement('p');
    status.textContent = result.decoded
      ? 'Native decode succeeded. HDR display output requires separate verification.'
      : `Decode failed: ${result.error}`;
    card.append(label, status, element);
    container.append(card);
    results.push(result);
  }
  return results;
}
