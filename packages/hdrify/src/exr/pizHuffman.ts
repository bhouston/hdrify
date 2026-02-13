/**
 * PIZ Huffman decompression
 * Used by PIZ compression for OpenEXR
 */

import {
  HUF_DECBITS,
  HUF_DECMASK,
  HUF_DECSIZE,
  HUF_ENCSIZE,
  INT8_SIZE,
  INT32_SIZE,
  LONG_ZEROCODE_RUN,
  SHORT_ZEROCODE_RUN,
  SHORTEST_LONG_RUN,
} from './exrConstants.js';

interface HufDec {
  len: number;
  lit: number;
  p: number[] | null;
}

function hufClearDecTable(hdec: HufDec[]): void {
  for (let i = 0; i < HUF_DECSIZE; i++) {
    hdec[i] = { len: 0, lit: 0, p: null };
  }
}

function parseUint32(dataView: DataView, offset: { value: number }): number {
  const value = dataView.getUint32(offset.value, true);
  offset.value += INT32_SIZE;
  return value;
}

function parseUint8Array(uInt8Array: Uint8Array, offset: { value: number }): number {
  const value = uInt8Array[offset.value];
  offset.value += INT8_SIZE;
  if (value === undefined) {
    throw new Error('Unexpected end of data');
  }
  return value;
}

const getBitsReturn = { l: 0, c: 0, lc: 0 };

function getBits(nBits: number, c: number, lc: number, uInt8Array: Uint8Array, inOffset: { value: number }): void {
  let currentC = c;
  let currentLc = lc;
  while (currentLc < nBits) {
    currentC = (currentC << 8) | parseUint8Array(uInt8Array, inOffset);
    currentLc += 8;
  }
  currentLc -= nBits;
  getBitsReturn.l = (currentC >> currentLc) & ((1 << nBits) - 1);
  getBitsReturn.c = currentC;
  getBitsReturn.lc = currentLc;
}

const hufTableBuffer = new Array(59);

function hufCanonicalCodeTable(hcode: number[]): void {
  for (let i = 0; i <= 58; ++i) hufTableBuffer[i] = 0;
  for (let i = 0; i < HUF_ENCSIZE; ++i) {
    const code = hcode[i];
    if (code !== undefined) {
      const bufferIndex = hufTableBuffer[code];
      if (bufferIndex !== undefined) {
        hufTableBuffer[code] = bufferIndex + 1;
      }
    }
  }

  let c = 0;
  for (let i = 58; i > 0; --i) {
    const bufferValue = hufTableBuffer[i];
    if (bufferValue !== undefined) {
      const nc = (c + bufferValue) >> 1;
      hufTableBuffer[i] = c;
      c = nc;
    }
  }

  for (let i = 0; i < HUF_ENCSIZE; ++i) {
    const l = hcode[i];
    if (l !== undefined && l > 0) {
      const bufferValue = hufTableBuffer[l];
      if (bufferValue !== undefined) {
        hcode[i] = l | (bufferValue << 6);
        hufTableBuffer[l] = bufferValue + 1;
      }
    }
  }
}

function hufUnpackEncTable(
  uInt8Array: Uint8Array,
  inOffset: { value: number },
  ni: number,
  im: number,
  iM: number,
  hcode: number[],
): void {
  const p = inOffset;
  let c = 0;
  let lc = 0;
  let currentIm = im;

  for (; currentIm <= iM; currentIm++) {
    if (p.value - inOffset.value > ni) return;

    getBits(6, c, lc, uInt8Array, p);
    const l = getBitsReturn.l;
    c = getBitsReturn.c;
    lc = getBitsReturn.lc;

    hcode[currentIm] = l;

    if (l === LONG_ZEROCODE_RUN) {
      if (p.value - inOffset.value > ni) {
        // biome-ignore lint/security/noSecrets: This is an error message, not a secret
        throw new Error('Something wrong with hufUnpackEncTable');
      }

      getBits(8, c, lc, uInt8Array, p);
      const zerun = getBitsReturn.l + SHORTEST_LONG_RUN;
      c = getBitsReturn.c;
      lc = getBitsReturn.lc;

      if (currentIm + zerun > iM + 1) {
        // biome-ignore lint/security/noSecrets: This is an error message, not a secret
        throw new Error('Something wrong with hufUnpackEncTable');
      }

      let runCount = zerun;
      while (runCount-- > 0) {
        hcode[currentIm++] = 0;
      }
      currentIm--;
    } else if (l >= SHORT_ZEROCODE_RUN) {
      const zerun = l - SHORT_ZEROCODE_RUN + 2;
      if (currentIm + zerun > iM + 1) {
        // biome-ignore lint/security/noSecrets: This is an error message, not a secret
        throw new Error('Something wrong with hufUnpackEncTable');
      }
      let runCount = zerun;
      while (runCount-- > 0) {
        hcode[currentIm++] = 0;
      }
      currentIm--;
    }
  }

  hufCanonicalCodeTable(hcode);
}

function hufLength(code: number): number {
  return code & 63;
}

function hufCode(code: number): number {
  return code >> 6;
}

function hufBuildDecTable(hcode: number[], im: number, iM: number, hdecod: HufDec[]): boolean {
  let currentIm = im;
  for (; currentIm <= iM; currentIm++) {
    const hcodeValue = hcode[currentIm];
    if (hcodeValue === undefined) {
      continue;
    }
    const c = hufCode(hcodeValue);
    const l = hufLength(hcodeValue);

    if (c >> l) {
      throw new Error('Invalid table entry');
    }

    if (l > HUF_DECBITS) {
      const index = c >> (l - HUF_DECBITS);
      const pl = hdecod[index];
      if (!pl) {
        throw new Error('Invalid table entry');
      }
      if (pl.len) {
        throw new Error('Invalid table entry');
      }
      pl.lit++;
      if (pl.p) {
        const p = pl.p;
        pl.p = new Array(pl.lit);
        for (let i = 0; i < pl.lit - 1; ++i) {
          const pValue = p[i];
          if (pValue !== undefined) {
            pl.p[i] = pValue;
          }
        }
      } else {
        pl.p = new Array(1);
      }
      pl.p[pl.lit - 1] = currentIm;
    } else if (l) {
      let plOffset = 0;
      for (let i = 1 << (HUF_DECBITS - l); i > 0; i--) {
        const index = (c << (HUF_DECBITS - l)) + plOffset;
        const pl = hdecod[index];
        if (!pl) {
          throw new Error('Invalid table entry');
        }
        if (pl.len || pl.p) {
          throw new Error('Invalid table entry');
        }
        pl.len = l;
        pl.lit = currentIm;
        plOffset++;
      }
    }
  }
  return true;
}

const getCharReturn = { c: 0, lc: 0 };

function getChar(c: number, lc: number, uInt8Array: Uint8Array, inOffset: { value: number }): void {
  const newC = (c << 8) | parseUint8Array(uInt8Array, inOffset);
  const newLc = lc + 8;
  getCharReturn.c = newC;
  getCharReturn.lc = newLc;
}

const getCodeReturn = { c: 0, lc: 0 };

function getCode(
  po: number,
  rlc: number,
  c: number,
  lc: number,
  uInt8Array: Uint8Array,
  inOffset: { value: number },
  outBuffer: Uint16Array,
  outBufferOffset: { value: number },
  outBufferEndOffset: number,
): void {
  let currentC = c;
  let currentLc = lc;
  if (po === rlc) {
    if (currentLc < 8) {
      getChar(currentC, currentLc, uInt8Array, inOffset);
      currentC = getCharReturn.c;
      currentLc = getCharReturn.lc;
    }
    currentLc -= 8;
    let cs = currentC >> currentLc;
    const csArray = new Uint8Array([cs]);
    // biome-ignore lint/style/noNonNullAssertion: Uint8Array([cs]) always has element at 0
    cs = csArray[0]!;

    if (outBufferOffset.value + cs > outBufferEndOffset) {
      getCodeReturn.c = currentC;
      getCodeReturn.lc = currentLc;
      return;
    }

    const s = outBuffer[outBufferOffset.value - 1];
    if (s !== undefined) {
      let runCount = cs;
      while (runCount-- > 0) {
        outBuffer[outBufferOffset.value++] = s;
      }
    }
  } else if (outBufferOffset.value < outBufferEndOffset) {
    outBuffer[outBufferOffset.value++] = po;
  }

  getCodeReturn.c = currentC;
  getCodeReturn.lc = currentLc;
}

function hufDecode(
  encodingTable: number[],
  decodingTable: HufDec[],
  uInt8Array: Uint8Array,
  inOffset: { value: number },
  ni: number,
  rlc: number,
  no: number,
  outBuffer: Uint16Array,
  outOffset: { value: number },
): void {
  let c = 0;
  let lc = 0;
  const outBufferEndOffset = no;
  const inOffsetEnd = Math.trunc(inOffset.value + (ni + 7) / 8);

  while (inOffset.value < inOffsetEnd) {
    getChar(c, lc, uInt8Array, inOffset);
    c = getCharReturn.c;
    lc = getCharReturn.lc;

    while (lc >= HUF_DECBITS) {
      const index: number = (c >> (lc - HUF_DECBITS)) & HUF_DECMASK;
      const pl = decodingTable[index];
      if (!pl) {
        throw new Error('hufDecode issues: invalid table index');
      }

      if (pl.len) {
        lc -= pl.len;
        getCode(pl.lit, rlc, c, lc, uInt8Array, inOffset, outBuffer, outOffset, outBufferEndOffset);
        c = getCodeReturn.c;
        lc = getCodeReturn.lc;
      } else {
        if (!pl.p) {
          throw new Error('hufDecode issues');
        }

        let j: number = 0;
        for (j = 0; j < pl.lit; j++) {
          const pIndex = pl.p[j];
          if (pIndex === undefined) {
            continue;
          }
          const encodingValue = encodingTable[pIndex];
          if (encodingValue === undefined) {
            continue;
          }
          const l = hufLength(encodingValue);

          while (lc < l && inOffset.value < inOffsetEnd) {
            getChar(c, lc, uInt8Array, inOffset);
            c = getCharReturn.c;
            lc = getCharReturn.lc;
          }

          if (lc >= l) {
            const codeValue = hufCode(encodingValue);
            if (codeValue === ((c >> (lc - l)) & ((1 << l) - 1))) {
              lc -= l;
              getCode(pIndex, rlc, c, lc, uInt8Array, inOffset, outBuffer, outOffset, outBufferEndOffset);
              c = getCodeReturn.c;
              lc = getCodeReturn.lc;
              break;
            }
          }
        }

        if (j >= pl.lit) {
          throw new Error('hufDecode issues');
        }
      }
    }
  }

  const i = (8 - ni) & 7;
  c >>= i;
  lc -= i;

  while (lc > 0) {
    const index = (c << (HUF_DECBITS - lc)) & HUF_DECMASK;
    const pl = decodingTable[index];
    if (!pl) {
      throw new Error('hufDecode issues: invalid table index');
    }
    if (pl.len) {
      lc -= pl.len;
      getCode(pl.lit, rlc, c, lc, uInt8Array, inOffset, outBuffer, outOffset, outBufferEndOffset);
      c = getCodeReturn.c;
      lc = getCodeReturn.lc;
    } else {
      throw new Error('hufDecode issues');
    }
  }
}

const LONGEST_LONG_RUN = 255 + SHORTEST_LONG_RUN;

function countFrequencies(freq: number[], data: Uint16Array, n: number): void {
  for (let i = 0; i < HUF_ENCSIZE; i++) freq[i] = 0;
  for (let i = 0; i < n; i++) {
    const d = data[i];
    if (d !== undefined) freq[d] = (freq[d] ?? 0) + 1;
  }
}

function hufBuildEncTable(frq: number[], im: { value: number }, iM: { value: number }): void {
  const hlink = new Array<number>(HUF_ENCSIZE);
  const fHeap: number[] = [];
  const scode = new Array<number>(HUF_ENCSIZE).fill(0);

  im.value = 0;
  while (!(frq[im.value] ?? 0)) im.value++;

  let nf = 0;
  for (let i = im.value; i < HUF_ENCSIZE; i++) {
    hlink[i] = i;
    if (frq[i] ?? 0) {
      fHeap.push(i);
      nf++;
      iM.value = i;
    }
  }

  iM.value++;
  frq[iM.value] = 1;
  fHeap.push(iM.value);
  nf++;

  const FHeapCompare = (a: number, b: number) =>
    (frq[a] ?? 0) > (frq[b] ?? 0) || ((frq[a] ?? 0) === (frq[b] ?? 0) && a > b);
  fHeap.sort((a, b) => (FHeapCompare(a, b) ? 1 : -1));

  while (nf > 1) {
    const mm = fHeap.shift();
    const m = fHeap[0];
    if (mm === undefined || m === undefined) break;
    fHeap.splice(0, 1);

    frq[m] = (frq[m] ?? 0) + (frq[mm] ?? 0);

    for (let j = m; ; ) {
      const s = (scode[j] ?? 0) + 1;
      scode[j] = s;
      if (s > 58) throw new Error('Huffman code length > 58');
      const next = hlink[j];
      if (next === j) {
        hlink[j] = mm;
        break;
      }
      j = next ?? j;
    }
    for (let j = mm; ; ) {
      const s = (scode[j] ?? 0) + 1;
      scode[j] = s;
      if (s > 58) throw new Error('Huffman code length > 58');
      const next = hlink[j];
      if (next === j) break;
      j = next ?? j;
    }

    fHeap.push(m);
    fHeap.sort((a, b) => (FHeapCompare(a, b) ? 1 : -1));
    nf--;
  }

  hufCanonicalCodeTable(scode);
  for (let i = 0; i < HUF_ENCSIZE; i++) {
    const s = scode[i];
    if (s !== undefined) frq[i] = s;
  }
}

function outputBits(nBits: number, bits: number, c: { value: number }, lc: { value: number }, out: number[]): void {
  c.value <<= nBits;
  lc.value += nBits;
  c.value |= bits;
  while (lc.value >= 8) {
    out.push((c.value >> (lc.value - 8)) & 0xff);
    lc.value -= 8;
  }
}

function hufPackEncTable(hcode: number[], im: number, iM: number, out: number[]): void {
  const c = { value: 0 };
  const lc = { value: 0 };
  let currentIm = im;

  while (currentIm <= iM) {
    // biome-ignore lint/style/noNonNullAssertion: currentIm in [im, iM] which are valid hcode indices
    const l = hufLength(hcode[currentIm]!);

    if (l === 0) {
      let zerun = 1;
      while (currentIm < iM && zerun < LONGEST_LONG_RUN) {
        // biome-ignore lint/style/noNonNullAssertion: currentIm+1 <= iM when currentIm < iM
        if (hufLength(hcode[currentIm + 1]!) > 0) break;
        currentIm++;
        zerun++;
      }
      if (zerun >= 2) {
        if (zerun >= SHORTEST_LONG_RUN) {
          outputBits(6, LONG_ZEROCODE_RUN, c, lc, out);
          outputBits(8, zerun - SHORTEST_LONG_RUN, c, lc, out);
        } else {
          outputBits(6, SHORT_ZEROCODE_RUN + zerun - 2, c, lc, out);
        }
        currentIm++;
        continue;
      }
    }
    outputBits(6, l, c, lc, out);
    currentIm++;
  }
  if (lc.value > 0) out.push((c.value << (8 - lc.value)) & 0xff);
}

function outputCode(code: number, c: { value: number }, lc: { value: number }, out: number[]): void {
  outputBits(hufLength(code), hufCode(code), c, lc, out);
}

function sendCode(
  sCode: number,
  runCount: number,
  runCode: number,
  c: { value: number },
  lc: { value: number },
  out: number[],
): void {
  const sLen = hufLength(sCode);
  const rLen = hufLength(runCode);
  if (sLen + rLen + 8 < sLen * (runCount + 1)) {
    outputCode(sCode, c, lc, out);
    outputCode(runCode, c, lc, out);
    outputBits(8, runCount, c, lc, out);
  } else {
    for (let i = 0; i <= runCount; i++) outputCode(sCode, c, lc, out);
  }
}

function hufEncode(hcode: number[], inData: Uint16Array, ni: number, rlc: number, out: number[]): number {
  const c = { value: 0 };
  const lc = { value: 0 };
  // biome-ignore-start lint/style/noNonNullAssertion: inData and hcode indices bounds-checked by ni and Huffman table
  let s = inData[0]!;
  let cs = 0;

  for (let i = 1; i < ni; i++) {
    const ns = inData[i]!;
    if (s === ns && cs < 255) {
      cs++;
    } else {
      sendCode(hcode[s]!, cs, hcode[rlc]!, c, lc, out);
      cs = 0;
    }
    s = ns;
  }
  sendCode(hcode[s]!, cs, hcode[rlc]!, c, lc, out);
  // biome-ignore-end lint/style/noNonNullAssertion: inData and hcode indices bounds-checked by ni and Huffman table

  if (lc.value > 0) out.push((c.value << (8 - lc.value)) & 0xff);
  return lc.value > 0 ? (out.length - 1) * 8 + lc.value : out.length * 8;
}

/**
 * Compress raw uint16 data using Huffman encoding.
 * Output format matches what hufUncompress expects: im(4), iM(4), tableLength(4), nBits(4), reserved(4), packed table, data.
 */
export function hufCompress(raw: Uint16Array): Uint8Array {
  const n = raw.length;
  if (n === 0) return new Uint8Array(0);

  const freq = new Array<number>(HUF_ENCSIZE);
  countFrequencies(freq, raw, n);

  const im = { value: 0 };
  const iM = { value: 0 };
  hufBuildEncTable(freq, im, iM);

  const tableOut: number[] = [];
  hufPackEncTable(freq, im.value, iM.value, tableOut);
  const tableLength = tableOut.length;

  const dataOut: number[] = [];
  const nBits = hufEncode(freq, raw, n, iM.value, dataOut);
  const dataLength = Math.ceil(nBits / 8);

  const totalSize = 20 + tableLength + dataLength;
  const result = new Uint8Array(totalSize);
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  view.setUint32(0, im.value, true);
  view.setUint32(4, iM.value, true);
  view.setUint32(8, tableLength, true);
  view.setUint32(12, nBits, true);
  view.setUint32(16, 0, true);
  result.set(tableOut, 20);
  result.set(dataOut, 20 + tableLength);

  return result;
}

/**
 * Decompress Huffman-encoded data (PIZ compression)
 */
export function hufUncompress(
  uInt8Array: Uint8Array,
  inDataView: DataView,
  inOffset: { value: number },
  nCompressed: number,
  outBuffer: Uint16Array,
  nRaw: number,
): void {
  const outOffset = { value: 0 };
  const initialInOffset = inOffset.value;

  const im = parseUint32(inDataView, inOffset);
  const iM = parseUint32(inDataView, inOffset);
  inOffset.value += 4;

  const nBits = parseUint32(inDataView, inOffset);
  inOffset.value += 4;

  if (im < 0 || im >= HUF_ENCSIZE || iM < 0 || iM >= HUF_ENCSIZE) {
    throw new Error(
      `Something wrong with HUF_ENCSIZE: im=${im}, iM=${iM}, HUF_ENCSIZE=${HUF_ENCSIZE}, compressedSize=${nCompressed}, offset=${inOffset.value}`,
    );
  }

  const freq = new Array(HUF_ENCSIZE);
  const hdec: HufDec[] = new Array(HUF_DECSIZE);
  hufClearDecTable(hdec);

  const ni = nCompressed - (inOffset.value - initialInOffset);
  hufUnpackEncTable(uInt8Array, inOffset, ni, im, iM, freq);

  if (nBits > 8 * (nCompressed - (inOffset.value - initialInOffset))) {
    // biome-ignore lint/security/noSecrets: This is an error message, not a secret
    throw new Error('Something wrong with hufUncompress');
  }

  hufBuildDecTable(freq, im, iM, hdec);
  hufDecode(freq, hdec, uInt8Array, inOffset, nBits, iM, nRaw, outBuffer, outOffset);
}
