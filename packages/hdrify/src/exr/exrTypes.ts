/**
 * EXR (OpenEXR) type definitions
 */

export interface ExrChannel {
  name: string;
  pixelType: number;
  pLinear: number;
  reserved: number;
  xSampling: number;
  ySampling: number;
}

export interface ExrBox2i {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/**
 * Parsed EXR header with required attributes for reading
 */
export interface ParsedExrHeader {
  /** Raw header metadata (all attributes) */
  header: Record<string, unknown>;
  /** Display window (optional for display) */
  displayWindow: ExrBox2i;
  /** Data window - defines image dimensions */
  dataWindow: ExrBox2i;
  /** Channel definitions */
  channels: ExrChannel[];
  /** Compression type (0=none, 1=RLE, 2=ZIPS, 3=ZIP, 4=PIZ) */
  compression: number;
}
