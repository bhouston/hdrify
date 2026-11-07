/**
 * JPEG XL image headers (ISO/IEC 18181-1, section 11 / Annex A): signature, SizeHeader, ImageMetadata,
 * ColorEncoding, ToneMapping, CustomTransformData and the entropy-coded ICC profile (Annex B.3 of 18181-1).
 * Reference: libjxl lib/jxl/headers.cc, image_metadata.cc, color_encoding_internal.cc, icc_codec*.cc;
 * jxl-oxide crates/jxl-image, crates/jxl-color/src/icc/decode.rs.
 */
import { type JxlBitReader, unpackSigned } from './jxlBitReader.js';
import { JxlEntropyDecoder } from './jxlEntropy.js';

export interface JxlSize {
  width: number;
  height: number;
}

export interface JxlBitDepth {
  floatSample: boolean;
  bitsPerSample: number;
  /** Exponent bits for float samples, 0 for integer samples. */
  expBits: number;
}

export type JxlExtraChannelType =
  | 'alpha'
  | 'depth'
  | 'spotColor'
  | 'selectionMask'
  | 'black'
  | 'cfa'
  | 'thermal'
  | 'unknown'
  | 'optional';

export interface JxlExtraChannelInfo {
  type: JxlExtraChannelType;
  bitDepth: JxlBitDepth;
  dimShift: number;
  name: string;
  alphaAssociated: boolean;
  /** Spot color [r, g, b, solidity] (type 'spotColor' only). */
  spotColor?: [number, number, number, number];
  /** CFA channel index (type 'cfa' only). */
  cfaChannel?: number;
}

export interface JxlAnimationHeader {
  tpsNumerator: number;
  tpsDenominator: number;
  numLoops: number;
  haveTimecodes: boolean;
}

export type JxlColorSpace = 'rgb' | 'gray' | 'xyb' | 'unknown';
export type JxlWhitePoint = 'd65' | 'custom' | 'e' | 'dci';
export type JxlPrimaries = 'srgb' | 'custom' | 'bt2100' | 'p3';
export type JxlTransferFunction = 'bt709' | 'unknown' | 'linear' | 'srgb' | 'pq' | 'dci' | 'hlg' | 'gamma';
export type JxlRenderingIntent = 'perceptual' | 'relative' | 'saturation' | 'absolute';
export type JxlXy = [number, number];

export interface JxlColorEncoding {
  wantIcc: boolean;
  colorSpace: JxlColorSpace;
  whitePoint: JxlWhitePoint;
  /** CIE xy of the white point (custom white point only). */
  whiteXy?: JxlXy;
  primaries: JxlPrimaries;
  /** CIE xy of the red, green, blue primaries (custom primaries only). */
  primariesXy?: [JxlXy, JxlXy, JxlXy];
  transferFunction: JxlTransferFunction;
  /** Encoding exponent in (0, 1] (e.g. 1/2.2) when `transferFunction === 'gamma'`; decode with x^(1/gamma). */
  gamma?: number;
  renderingIntent: JxlRenderingIntent;
}

export interface JxlToneMapping {
  intensityTarget: number;
  minNits: number;
  relativeToMaxDisplay: boolean;
  linearBelow: number;
}

export interface JxlOpsinInverseMatrix {
  /** Row-major 3x3 inverse opsin absorbance matrix. */
  matrix: number[];
  opsinBias: [number, number, number];
  quantBias: [number, number, number];
  quantBiasNumerator: number;
}

export interface JxlImageHeader extends JxlSize {
  orientation: number;
  intrinsicSize?: JxlSize;
  preview?: JxlSize;
  animation?: JxlAnimationHeader;
  bitDepth: JxlBitDepth;
  modular16BitBuffers: boolean;
  extraChannels: JxlExtraChannelInfo[];
  xybEncoded: boolean;
  colorEncoding: JxlColorEncoding;
  toneMapping: JxlToneMapping;
  opsinInverse: JxlOpsinInverseMatrix;
  /** Upsampling kernel weights (CustomTransformData), defaults from libjxl. */
  upsampling2Weights: number[];
  upsampling4Weights: number[];
  upsampling8Weights: number[];
  /** Decoded ICC profile, present when `colorEncoding.wantIcc`. */
  icc?: Uint8Array;
}

// prettier-ignore
export const DEFAULT_UPSAMPLING2_WEIGHTS: readonly number[] = [
  -0.017162, -0.03452303, -0.04022174, -0.02921014, -0.00624645, 0.14111091, 0.28896755, 0.00278718, -0.01610267,
  0.5666155, 0.03777607, -0.01986694, -0.03144731, -0.01185068, -0.00213539,
];
// prettier-ignore
export const DEFAULT_UPSAMPLING4_WEIGHTS: readonly number[] = [
  -0.02419067, -0.03491987, -0.03693351, -0.03094285, -0.00529785, -0.01663432, -0.03556863, -0.03888905, -0.0351685,
  -0.00989469, 0.23651958, 0.33392945, -0.01073543, -0.01313181, -0.03556694, 0.13048175, 0.40103025, 0.0395115,
  -0.02077584, 0.46914198, -0.0020927, -0.01484589, -0.04064806, 0.1894253, 0.56279892, 0.066744, -0.02335494,
  -0.03551682, -0.0075483, -0.02267919, -0.02363578, 0.00315804, -0.03399098, -0.01359519, -0.00091653, -0.00335467,
  -0.01163294, -0.01610294, -0.00974088, -0.00191622, -0.01095446, -0.03198464, -0.04455121, -0.0279979, -0.00645912,
  0.06390599, 0.22963888, 0.00630981, -0.01897349, 0.67537268, 0.08483369, -0.02534994, -0.02205197, -0.01667999,
  -0.00384443,
];
// prettier-ignore
export const DEFAULT_UPSAMPLING8_WEIGHTS: readonly number[] = [
  -0.02928613, -0.03706353, -0.03783812, -0.03324558, -0.00447632, -0.02519406, -0.03752601, -0.03901508, -0.03663285,
  -0.00646649, -0.02066407, -0.03838633, -0.04002101, -0.03900035, -0.00901973, -0.01626393, -0.03954148, -0.0404662,
  -0.03979621, -0.01224485, 0.29895328, 0.35757708, -0.02447552, -0.01081748, -0.04314594, 0.23903219, 0.41119301,
  -0.00573046, -0.01450239, -0.04246845, 0.17567618, 0.45220643, 0.02287757, -0.01936783, -0.03583255, 0.11572472,
  0.47416733, 0.0628444, -0.02685066, 0.4272005, -0.02248939, -0.01155273, -0.04562755, 0.28689496, 0.49093869,
  -0.00007891, -0.01545926, -0.04562659, 0.2123892, 0.53980934, 0.03369474, -0.02070211, -0.03866988, 0.1422955,
  0.56593398, 0.08045181, -0.02888298, -0.03680918, -0.00542229, -0.02920477, -0.02788574, -0.0211818, -0.03942402,
  -0.00775547, -0.02433614, -0.03193943, -0.02030828, -0.04044014, -0.01074016, -0.01930822, -0.03620399, -0.01974125,
  -0.03919545, -0.01456093, -0.00045072, -0.0036011, -0.01020207, -0.01231907, -0.00638988, -0.00071592, -0.00279122,
  -0.00957115, -0.01288327, -0.00730937, -0.00107783, -0.00210156, -0.00890705, -0.01317668, -0.00813895, -0.00153491,
  -0.02128481, -0.04173044, -0.04831487, -0.0329319, -0.0052526, -0.01720322, -0.04052736, -0.05045706, -0.03607317,
  -0.0073803, -0.01341764, -0.03965629, -0.05151616, -0.03814886, -0.01005819, 0.18968273, 0.33063684, -0.01300105,
  -0.0137295, -0.04017465, 0.13727832, 0.36402234, 0.0102789, -0.01832107, -0.03365072, 0.08734506, 0.38194295,
  0.04338228, -0.02525993, 0.56408126, 0.00458352, -0.01648227, -0.04887868, 0.24585519, 0.62026135, 0.04314807,
  -0.02213737, -0.04158014, 0.16637289, 0.65027023, 0.09621636, -0.03101388, -0.04082742, -0.00904519, -0.02790922,
  -0.02117818, 0.00798662, -0.03995711, -0.01243427, -0.02231705, -0.02946266, 0.00992055, -0.03600283, -0.0168492,
  -0.00111684, -0.00411204, -0.0129713, -0.01723725, -0.01022545, -0.00165306, -0.0031311, -0.01218016, -0.01763266,
  -0.0112562, -0.00231663, -0.01374149, -0.0379762, -0.05142937, -0.03117307, -0.00581914, -0.01064003, -0.03608089,
  -0.05272168, -0.0337567, -0.00795586, 0.09628104, 0.27129991, -0.00353779, -0.01734151, -0.03153981, 0.0568623,
  0.28500998, 0.02230594, -0.02374955, 0.68214326, 0.05018048, -0.02320852, -0.04383616, 0.18459474, 0.71517975,
  0.10805613, -0.03263677, -0.03637639, -0.01394373, -0.02511203, -0.01728636, 0.05407331, -0.02867568, -0.01893131,
  -0.00240854, -0.00446511, -0.01636187, -0.02377053, -0.01522848, -0.00333334, -0.00819975, -0.02964169, -0.04499287,
  -0.0274535, -0.00612408, 0.02727416, 0.194466, 0.00159832, -0.02232473, 0.74982506, 0.1145262, -0.03348048,
  -0.01605681, -0.02070339, -0.00458223,
];

/** libjxl cms/opsin_params.h kDefaultInverseOpsinAbsorbanceMatrix / kNegOpsinAbsorbanceBiasRGB; quantizer.h kDefaultQuantBias. */
export function defaultOpsinInverseMatrix(): JxlOpsinInverseMatrix {
  return {
    matrix: [
      11.031566901960783, -9.866943921568629, -0.16462299647058826, -3.254147380392157, 4.418770392156863,
      -0.16462299647058826, -3.6588512862745097, 2.7129230470588235, 1.9459282392156863,
    ],
    opsinBias: [-0.0037930732552754493, -0.0037930732552754493, -0.0037930732552754493],
    quantBias: [1 - 0.05465007330715401, 1 - 0.07005449891748593, 1 - 0.049935103337343655],
    quantBiasNumerator: 0.145,
  };
}

/** SizeHeader (and the preview variant). libjxl headers.cc SizeHeader/PreviewHeader::VisitFields. */
function readSize(br: JxlBitReader, preview: boolean): JxlSize {
  const div8 = br.readBool();
  const div8Dist = () => br.readU32(16, 32, { bits: 5, offset: 1 }, { bits: 9, offset: 33 });
  const fullDist = () =>
    preview
      ? br.readU32(
          { bits: 6, offset: 1 },
          { bits: 8, offset: 65 },
          { bits: 10, offset: 321 },
          { bits: 12, offset: 1345 },
        )
      : br.readU32({ bits: 9, offset: 1 }, { bits: 13, offset: 1 }, { bits: 18, offset: 1 }, { bits: 30, offset: 1 });
  const height = div8 ? 8 * (preview ? div8Dist() : 1 + br.readBits(5)) : fullDist();
  const ratio = br.readBits(3);
  let width: number;
  if (ratio !== 0) width = Math.floor((height * RATIOS[ratio - 1]![0]) / RATIOS[ratio - 1]![1]);
  else width = div8 ? 8 * (preview ? div8Dist() : 1 + br.readBits(5)) : fullDist();
  return { width, height };
}

const RATIOS: readonly [number, number][] = [
  [1, 1],
  [12, 10],
  [4, 3],
  [3, 2],
  [16, 9],
  [5, 4],
  [2, 1],
];

/** BitDepth bundle. libjxl image_metadata.cc BitDepth::VisitFields. */
export function readBitDepth(br: JxlBitReader): JxlBitDepth {
  if (br.readBool()) {
    const bitsPerSample = br.readU32(32, 16, 24, { bits: 6, offset: 1 });
    const expBits = br.readBits(4) + 1;
    const mantissaBits = bitsPerSample - expBits - 1;
    if (expBits < 2 || expBits > 8 || mantissaBits < 2 || mantissaBits > 23)
      throw new Error('JXL: invalid float bit depth');
    return { floatSample: true, bitsPerSample, expBits };
  }
  const bitsPerSample = br.readU32(8, 10, 12, { bits: 6, offset: 1 });
  if (bitsPerSample > 31) throw new Error('JXL: invalid bits_per_sample');
  return { floatSample: false, bitsPerSample, expBits: 0 };
}

/** Name string: U32 length then UTF-8 bytes. libjxl frame_header.h VisitNameString. */
export function readName(br: JxlBitReader): string {
  const len = br.readU32(0, { bits: 4 }, { bits: 5, offset: 16 }, { bits: 10, offset: 48 });
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = br.readBits(8);
  return new TextDecoder().decode(bytes);
}

/** Extensions: U64 bitmask, then one U64 bit length per set bit; the payloads are skipped. */
export function skipExtensions(br: JxlBitReader): void {
  const mask = br.readU64();
  let total = 0;
  for (let i = 0; i < 64; i++) if (Math.floor(mask / 2 ** i) % 2) total += br.readU64();
  br.skip(total);
}

const EC_TYPES: Record<number, JxlExtraChannelType> = {
  0: 'alpha',
  1: 'depth',
  2: 'spotColor',
  3: 'selectionMask',
  4: 'black',
  5: 'cfa',
  6: 'thermal',
  15: 'unknown',
  16: 'optional',
};

function readExtraChannel(br: JxlBitReader): JxlExtraChannelInfo {
  if (br.readBool()) {
    return {
      type: 'alpha',
      bitDepth: { floatSample: false, bitsPerSample: 8, expBits: 0 },
      dimShift: 0,
      name: '',
      alphaAssociated: false,
    };
  }
  const typeId = br.readEnum();
  const type = EC_TYPES[typeId];
  if (!type) throw new Error(`JXL: invalid extra channel type ${typeId}`);
  const bitDepth = readBitDepth(br);
  const dimShift = br.readU32(0, 3, 4, { bits: 3, offset: 1 });
  if (dimShift > 3) throw new Error('JXL: dim_shift too large');
  const name = readName(br);
  const info: JxlExtraChannelInfo = { type, bitDepth, dimShift, name, alphaAssociated: false };
  if (type === 'alpha') info.alphaAssociated = br.readBool();
  if (type === 'spotColor') info.spotColor = [br.readF16(), br.readF16(), br.readF16(), br.readF16()];
  if (type === 'cfa') info.cfaChannel = br.readU32(1, { bits: 2 }, { bits: 4, offset: 3 }, { bits: 8, offset: 19 });
  return info;
}

function readCustomXy(br: JxlBitReader): JxlXy {
  const d = () =>
    unpackSigned(
      br.readU32(
        { bits: 19 },
        { bits: 19, offset: 524288 },
        { bits: 20, offset: 1048576 },
        { bits: 21, offset: 2097152 },
      ),
    ) / 1e6;
  const x = d();
  return [x, d()];
}

const COLOR_SPACES: JxlColorSpace[] = ['rgb', 'gray', 'xyb', 'unknown'];
const WHITE_POINTS: Record<number, JxlWhitePoint> = { 1: 'd65', 2: 'custom', 10: 'e', 11: 'dci' };
const PRIMARIES: Record<number, JxlPrimaries> = { 1: 'srgb', 2: 'custom', 9: 'bt2100', 11: 'p3' };
const TRANSFERS: Record<number, JxlTransferFunction> = {
  1: 'bt709',
  2: 'unknown',
  8: 'linear',
  13: 'srgb',
  16: 'pq',
  17: 'dci',
  18: 'hlg',
};
const INTENTS: JxlRenderingIntent[] = ['perceptual', 'relative', 'saturation', 'absolute'];

function enumOf<T>(table: Record<number, T> | T[], v: number, what: string): T {
  const r = (table as Record<number, T>)[v];
  if (r === undefined) throw new Error(`JXL: invalid ${what} ${v}`);
  return r;
}

/** The all_default ColorEncoding: sRGB, D65, relative intent. */
export function defaultColorEncoding(): JxlColorEncoding {
  return {
    wantIcc: false,
    colorSpace: 'rgb',
    whitePoint: 'd65',
    primaries: 'srgb',
    transferFunction: 'srgb',
    renderingIntent: 'relative',
  };
}

/** ColorEncoding bundle. libjxl color_encoding_internal.cc ColorEncoding::VisitFields. */
export function readColorEncoding(br: JxlBitReader): JxlColorEncoding {
  const ce = defaultColorEncoding();
  if (br.readBool()) return ce;
  ce.wantIcc = br.readBool();
  ce.colorSpace = enumOf(COLOR_SPACES, br.readEnum(), 'color space');
  if (ce.wantIcc) return ce;
  const xyb = ce.colorSpace === 'xyb';
  if (!xyb) {
    ce.whitePoint = enumOf(WHITE_POINTS, br.readEnum(), 'white point');
    if (ce.whitePoint === 'custom') ce.whiteXy = readCustomXy(br);
  }
  if (!xyb && ce.colorSpace !== 'gray') {
    ce.primaries = enumOf(PRIMARIES, br.readEnum(), 'primaries');
    if (ce.primaries === 'custom') ce.primariesXy = [readCustomXy(br), readCustomXy(br), readCustomXy(br)];
  }
  if (xyb) {
    // CustomTransferFunction::SetImplicit: XYB implies gamma 1/3 and nothing is serialized.
    ce.transferFunction = 'gamma';
    ce.gamma = 1 / 3;
  } else if (br.readBool()) {
    const g = br.readBits(24);
    if (g === 0 || g > 10_000_000) throw new Error(`JXL: invalid gamma ${g}`);
    ce.transferFunction = 'gamma';
    ce.gamma = g / 1e7;
  } else {
    ce.transferFunction = enumOf(TRANSFERS, br.readEnum(), 'transfer function');
  }
  ce.renderingIntent = enumOf(INTENTS, br.readEnum(), 'rendering intent');
  return ce;
}

function readToneMapping(br: JxlBitReader): JxlToneMapping {
  const tm: JxlToneMapping = { intensityTarget: 255, minNits: 0, relativeToMaxDisplay: false, linearBelow: 0 };
  if (br.readBool()) return tm;
  tm.intensityTarget = br.readF16();
  tm.minNits = br.readF16();
  tm.relativeToMaxDisplay = br.readBool();
  tm.linearBelow = br.readF16();
  if (tm.intensityTarget <= 0 || tm.minNits < 0 || tm.minNits > tm.intensityTarget) {
    throw new Error('JXL: invalid tone mapping');
  }
  if (tm.linearBelow < 0 || (tm.relativeToMaxDisplay && tm.linearBelow > 1))
    throw new Error('JXL: invalid linear_below');
  return tm;
}

function readF16s(br: JxlBitReader, n: number): number[] {
  return Array.from({ length: n }, () => br.readF16());
}

/**
 * Read the codestream headers: signature, SizeHeader, ImageMetadata, CustomTransformData, then the ICC profile
 * if `want_icc`, finishing at the byte boundary where the first frame (or preview frame) begins.
 * libjxl decode.cc ReadBundle(CodecMetadata) + ICCReader.
 */
export function readImageHeader(br: JxlBitReader): JxlImageHeader {
  if (br.readBits(16) !== 0x0aff) throw new Error('JXL: bad codestream signature');
  const size = readSize(br, false);
  const h: JxlImageHeader = {
    ...size,
    orientation: 1,
    bitDepth: { floatSample: false, bitsPerSample: 8, expBits: 0 },
    modular16BitBuffers: true,
    extraChannels: [],
    xybEncoded: true,
    colorEncoding: defaultColorEncoding(),
    toneMapping: { intensityTarget: 255, minNits: 0, relativeToMaxDisplay: false, linearBelow: 0 },
    opsinInverse: defaultOpsinInverseMatrix(),
    upsampling2Weights: [...DEFAULT_UPSAMPLING2_WEIGHTS],
    upsampling4Weights: [...DEFAULT_UPSAMPLING4_WEIGHTS],
    upsampling8Weights: [...DEFAULT_UPSAMPLING8_WEIGHTS],
  };

  // ImageMetadata
  if (!br.readBool()) {
    const extraFields = br.readBool();
    if (extraFields) {
      h.orientation = 1 + br.readBits(3);
      if (br.readBool()) h.intrinsicSize = readSize(br, false);
      if (br.readBool()) h.preview = readSize(br, true);
      if (br.readBool()) {
        h.animation = {
          tpsNumerator: br.readU32(100, 1000, { bits: 10, offset: 1 }, { bits: 30, offset: 1 }),
          tpsDenominator: br.readU32(1, 1001, { bits: 8, offset: 1 }, { bits: 10, offset: 1 }),
          numLoops: br.readU32(0, { bits: 3 }, { bits: 16 }, { bits: 32 }),
          haveTimecodes: br.readBool(),
        };
      }
    }
    h.bitDepth = readBitDepth(br);
    h.modular16BitBuffers = br.readBool();
    const numExtra = br.readU32(0, 1, { bits: 4, offset: 2 }, { bits: 12, offset: 1 });
    if (numExtra > 256) throw new Error('JXL: too many extra channels');
    for (let i = 0; i < numExtra; i++) h.extraChannels.push(readExtraChannel(br));
    h.xybEncoded = br.readBool();
    h.colorEncoding = readColorEncoding(br);
    if (extraFields) h.toneMapping = readToneMapping(br);
    skipExtensions(br);
  }

  // CustomTransformData (default_m)
  if (!br.readBool()) {
    if (h.xybEncoded && !br.readBool()) {
      h.opsinInverse = {
        matrix: readF16s(br, 9),
        opsinBias: [br.readF16(), br.readF16(), br.readF16()],
        quantBias: [br.readF16(), br.readF16(), br.readF16()],
        quantBiasNumerator: br.readF16(),
      };
    }
    const mask = br.readBits(3);
    if (mask & 1) h.upsampling2Weights = readF16s(br, 15);
    if (mask & 2) h.upsampling4Weights = readF16s(br, 55);
    if (mask & 4) h.upsampling8Weights = readF16s(br, 210);
  }

  if (h.colorEncoding.wantIcc) h.icc = readIccProfile(br);
  br.zeroPadToByte();
  br.checkBounds();
  return h;
}

/** Number of color channels: 1 for grayscale, otherwise 3. */
export function numColorChannels(h: JxlImageHeader): number {
  return h.colorEncoding.colorSpace === 'gray' ? 1 : 3;
}

export interface JxlColorDescription {
  /** True if the color space is given by `icc` rather than the fields below. */
  icc: boolean;
  colorSpace: JxlColorSpace;
  primaries: 'srgb' | 'p3' | 'rec2020' | { red: JxlXy; green: JxlXy; blue: JxlXy };
  whitePoint: 'd65' | 'dci' | 'e' | JxlXy;
  /** Transfer function, or the encoding gamma exponent (e.g. 0.4545 for gamma 2.2). */
  transfer: 'linear' | 'srgb' | 'pq' | 'hlg' | 'dci' | '709' | 'unknown' | number;
}

/** Collapse a ColorEncoding into simple terms. */
export function describeColorEncoding(ce: JxlColorEncoding): JxlColorDescription {
  const p = ce.primariesXy;
  const tf = ce.transferFunction;
  return {
    icc: ce.wantIcc,
    colorSpace: ce.colorSpace,
    primaries: p
      ? { red: p[0], green: p[1], blue: p[2] }
      : ce.primaries === 'bt2100'
        ? 'rec2020'
        : ce.primaries === 'p3'
          ? 'p3'
          : 'srgb',
    whitePoint: ce.whiteXy ?? (ce.whitePoint === 'custom' ? 'd65' : ce.whitePoint),
    transfer: tf === 'gamma' ? ce.gamma! : tf === 'bt709' ? '709' : tf,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// ICC profile (ISO/IEC 18181-1 Annex B.3; libjxl icc_codec.cc / icc_codec_common.cc)

/** Context for ICC byte `i` given the two previous bytes. libjxl ICCANSContext. */
function iccContext(i: number, b1: number, b2: number): number {
  if (i <= 128) return 0;
  const isAlpha = (b: number) => (b >= 0x61 && b <= 0x7a) || (b >= 0x41 && b <= 0x5a);
  const isNum = (b: number) => (b >= 0x30 && b <= 0x39) || b === 0x2e || b === 0x2c;
  const k1 = isAlpha(b1)
    ? 0
    : isNum(b1)
      ? 1
      : b1 === 0
        ? 2
        : b1 === 1
          ? 3
          : b1 < 16
            ? 4
            : b1 === 255
              ? 6
              : b1 > 240
                ? 5
                : 7;
  const k2 = isAlpha(b2) ? 0 : isNum(b2) ? 1 : b2 < 16 ? 2 : b2 > 240 ? 3 : 4;
  return 1 + k1 + 8 * k2;
}

/** Read and reconstruct the entropy-coded ICC profile. libjxl ICCReader::Init/Process + UnpredictICC. */
export function readIccProfile(br: JxlBitReader): Uint8Array {
  const encSize = br.readU64();
  if (encSize > 1 << 28) throw new Error('JXL: encoded ICC profile too large');
  const dec = JxlEntropyDecoder.read(br, 41);
  dec.begin(br);
  const enc = new Uint8Array(encSize);
  for (let i = 0; i < encSize; i++) {
    enc[i] = dec.readUint(br, iccContext(i, i > 0 ? enc[i - 1]! : 0, i > 1 ? enc[i - 2]! : 0)) & 0xff;
  }
  dec.finish();
  return unpredictIcc(enc);
}

const TAG_STRINGS = [
  'cprt',
  'wtpt',
  'bkpt',
  'rXYZ',
  'gXYZ',
  'bXYZ',
  'kXYZ',
  'rTRC',
  'gTRC',
  'bTRC',
  'kTRC',
  'chad',
  'desc',
  'chrm',
  'dmnd',
  'dmdd',
  'lumi',
];
const TYPE_STRINGS = ['XYZ ', 'desc', 'text', 'mluc', 'para', 'curv', 'sf32', 'gbd '];
const FIXED_SIZE_TAGS = new Set(['rXYZ', 'gXYZ', 'bXYZ', 'kXYZ', 'wtpt', 'bkpt', 'lumi']);

/** Inverse of the encoder's transpose: `Shuffle` in libjxl icc_codec.cc. */
function shuffle(data: Uint8Array, width: number): Uint8Array {
  const size = data.length;
  const height = Math.ceil(size / width);
  const out = new Uint8Array(size);
  for (let i = 0, j = 0, s = 0; i < size; i++) {
    out[i] = data[j]!;
    j += height;
    if (j >= size) j = ++s;
  }
  return out;
}

/** Decode the ICC predictor stream (varint sizes, header, tag list, command/data streams) into the profile. */
export function unpredictIcc(enc: Uint8Array): Uint8Array {
  const fail = (msg: string): never => {
    throw new Error(`JXL: invalid ICC stream (${msg})`);
  };
  let pos = 0;
  const varint = (end: number, at: { p: number }): number => {
    let v = 0;
    for (let shift = 0; ; shift += 7) {
      if (at.p >= end || shift > 63) fail('truncated varint');
      const b = enc[at.p++]!;
      v += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return v;
    }
  };
  const head = { p: 0 };
  const osize = varint(enc.length, head);
  const csize = varint(enc.length, head);
  if (osize > 0xffffffff || osize > 1 << 28) fail('output too large');
  const cmd = { p: head.p };
  const commandsEnd = cmd.p + csize;
  if (commandsEnd > enc.length) fail('commands out of bounds');
  pos = commandsEnd;

  const out = new Uint8Array(osize);
  let n = 0;
  const push = (b: number) => {
    if (n >= osize) fail('output overflow');
    out[n++] = b & 0xff;
  };
  const pushU32 = (v: number) => {
    push(v >>> 24);
    push(v >>> 16);
    push(v >>> 8);
    push(v);
  };
  const pushTag = (t: string) => {
    for (let i = 0; i < 4; i++) push(t.charCodeAt(i));
  };
  const take = (count: number): Uint8Array => {
    if (pos + count > enc.length) fail('data out of bounds');
    const d = enc.subarray(pos, pos + count);
    pos += count;
    return d;
  };

  // Header (128 bytes) with ICCPredictHeader.
  const header = new Uint8Array(128);
  header.set([0x6d, 0x6e, 0x74, 0x72, 0x52, 0x47, 0x42, 0x20, 0x58, 0x59, 0x5a, 0x20], 12); // 'mntrRGB XYZ '
  header.set([0x61, 0x63, 0x73, 0x70], 36); // 'acsp'
  header[8] = 4;
  header[70] = 246;
  header[71] = 214;
  header[73] = 1;
  header[78] = 211;
  header[79] = 45;
  header.set([osize >>> 24, (osize >>> 16) & 0xff, (osize >>> 8) & 0xff, osize & 0xff], 0);
  for (let i = 0; i < 128; i++) {
    if (n === osize) {
      if (cmd.p !== commandsEnd || pos !== enc.length) fail('unused data');
      return out;
    }
    if (i === 8) header.set(out.subarray(4, 8), 80);
    if (i === 41 && out[40] === 0x41) header.set([0x50, 0x50, 0x4c], 41); // 'APPL'
    if (i === 41 && out[40] === 0x4d) header.set([0x53, 0x46, 0x54], 41); // 'MSFT'
    if (i === 42 && out[40] === 0x53 && out[41] === 0x47) header.set([0x49, 0x20], 42); // 'SGI '
    if (i === 42 && out[40] === 0x53 && out[41] === 0x55) header.set([0x4e, 0x57], 42); // 'SUNW'
    push(take(1)[0]! + header[i]!);
  }
  if (n === osize) {
    if (cmd.p !== commandsEnd || pos !== enc.length) fail('unused data');
    return out;
  }
  if (cmd.p >= commandsEnd) fail('missing tag list');

  // Tag list
  let numTags = varint(commandsEnd, cmd);
  if (numTags !== 0) {
    numTags--;
    pushU32(numTags);
    let prevStart = 128 + numTags * 12;
    let prevSize = 0;
    while (cmd.p < commandsEnd) {
      const command = enc[cmd.p++]!;
      const tagCode = command & 63;
      if (tagCode === 0) break;
      let tag: string;
      if (tagCode === 1) tag = String.fromCharCode(...take(4));
      else if (tagCode === 2) tag = 'rTRC';
      else if (tagCode === 3) tag = 'rXYZ';
      else tag = TAG_STRINGS[tagCode - 4] ?? fail('unknown tag code');
      pushTag(tag);
      const start = command & 64 ? varint(commandsEnd, cmd) : prevStart + prevSize;
      let size = FIXED_SIZE_TAGS.has(tag) ? 20 : prevSize;
      if (command & 128) size = varint(commandsEnd, cmd);
      if (start > 0xffffffff || size > 0xffffffff) fail('tag out of range');
      pushU32(start);
      pushU32(size);
      prevStart = start;
      prevSize = size;
      if (tagCode === 2) {
        for (const t of ['gTRC', 'bTRC']) {
          pushTag(t);
          pushU32(start);
          pushU32(size);
        }
      } else if (tagCode === 3) {
        for (const [k, t] of ['gXYZ', 'bXYZ'].entries()) {
          pushTag(t);
          pushU32(start + size * (k + 1));
          pushU32(size);
        }
      }
    }
  }

  // Main content
  while (cmd.p < commandsEnd) {
    const command = enc[cmd.p++]!;
    if (command === 1) {
      for (const b of take(varint(commandsEnd, cmd))) push(b);
    } else if (command === 2 || command === 3) {
      for (const b of shuffle(take(varint(commandsEnd, cmd)), command === 2 ? 2 : 4)) push(b);
    } else if (command === 4) {
      if (cmd.p + 2 > commandsEnd) fail('truncated predict');
      const flags = enc[cmd.p++]!;
      const width = (flags & 3) + 1;
      const order = (flags >> 2) & 3;
      if (width === 3 || order === 3) fail('invalid predict flags');
      const stride = flags & 16 ? varint(commandsEnd, cmd) : width;
      if (stride < width || n === 0 || (n - 1) >> 2 < stride) fail('invalid stride');
      const num = varint(commandsEnd, cmd);
      const raw = take(num);
      const data = width > 1 ? shuffle(raw, width) : raw;
      const start = n;
      for (let i = 0; i < num; i++) push(data[i]! + linearPredict(out, start, i, stride, width, order));
    } else if (command === 10) {
      pushTag('XYZ ');
      pushU32(0);
      for (const b of take(12)) push(b);
    } else if (command >= 16 && command < 16 + TYPE_STRINGS.length) {
      pushTag(TYPE_STRINGS[command - 16]!);
      pushU32(0);
    } else {
      fail(`unknown command ${command}`);
    }
  }
  if (pos !== enc.length) fail('unused data');
  if (n !== osize) fail('size mismatch');
  return out;
}

/** libjxl LinearPredictICCValue: order-0..2 prediction on big-endian integers of `width` bytes. */
function linearPredict(
  data: Uint8Array,
  start: number,
  i: number,
  stride: number,
  width: number,
  order: number,
): number {
  const p = start + i - (i % width);
  const load = (at: number) => {
    let v = 0;
    for (let k = 0; k < width; k++) v = v * 256 + data[at + k]!;
    return v;
  };
  const p1 = load(p - stride);
  const p2 = load(p - stride * 2);
  const p3 = load(p - stride * 3);
  const modulus = 2 ** (8 * width);
  const pred = order === 0 ? p1 : order === 1 ? 2 * p1 - p2 : 3 * p1 - 3 * p2 + p3;
  const wrapped = ((pred % modulus) + modulus) % modulus;
  return Math.floor(wrapped / 2 ** (8 * (width - 1 - (i % width)))) & 0xff;
}
