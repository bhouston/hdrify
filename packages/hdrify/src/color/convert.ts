/**
 * Color space conversion utilities.
 * convertFloat32ToLinearColorSpace returns original data when no conversion needed.
 */

import type { FloatImageData } from '../floatImage.js';
import type { DisplayColorSpace, LinearColorSpace } from './colorSpaces.js';
import {
  getChromaticitiesForDisplay,
  getChromaticitiesForLinear,
  getLinearColorSpaceForDisplay,
} from './colorSpaces.js';
import { applyMatrix3, buildLinearToLinearMatrix } from './matrixConversion.js';
import { displayToLinear, linearToDisplay } from './transfer.js';

/**
 * Convert Float32Array RGBA pixel data from one linear color space to another.
 * If from === to, returns the original data without copying.
 * Otherwise creates a new Float32Array (does not mutate input).
 *
 * @param data - RGBA Float32Array
 * @param width - Image width
 * @param height - Image height
 * @param from - Source linear color space
 * @param to - Target linear color space
 * @returns Original data if no conversion; otherwise new Float32Array with converted pixels
 */
export function convertFloat32ToLinearColorSpace(
  data: Float32Array,
  _width: number,
  _height: number,
  from: LinearColorSpace,
  to: LinearColorSpace,
): Float32Array {
  if (from === to) {
    return data;
  }

  const matrix = buildLinearToLinearMatrix(getChromaticitiesForLinear(from), getChromaticitiesForLinear(to));

  const out = new Float32Array(data.length);
  out.set(data);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const [r2, g2, b2] = applyMatrix3(r, g, b, matrix);
    out[i] = r2;
    out[i + 1] = g2;
    out[i + 2] = b2;
  }

  return out;
}

/**
 * Convert FloatImageData to a different linear color space.
 * Returns a new image with converted data.
 */
export function convertLinearColorSpace(image: FloatImageData, to: LinearColorSpace): FloatImageData {
  const data = convertFloat32ToLinearColorSpace(image.data, image.width, image.height, image.linearColorSpace, to);

  return {
    ...image,
    data,
    linearColorSpace: to,
  };
}

/**
 * Convert linear FloatImageData to display-referred for a given display space.
 * Converts primaries to match display space if needed, then applies transfer function.
 * Returns new image with display-encoded data in Float32Array (values 0-1).
 */
export function convertLinearToDisplay(
  image: FloatImageData,
  to: DisplayColorSpace,
): FloatImageData & { displayColorSpace: DisplayColorSpace } {
  const targetLinear = getLinearColorSpaceForDisplay(to);
  const linearData = convertFloat32ToLinearColorSpace(
    image.data,
    image.width,
    image.height,
    image.linearColorSpace,
    targetLinear,
  );

  const out = new Float32Array(linearData.length);
  const pixelCount = image.width * image.height;

  for (let i = 0; i < pixelCount; i++) {
    const si = i * 4;
    const r = linearData[si] ?? 0;
    const g = linearData[si + 1] ?? 0;
    const b = linearData[si + 2] ?? 0;
    const a = linearData[si + 3] ?? 1;

    const [r2, g2, b2] = linearToDisplay(r, g, b, to);
    out[si] = r2;
    out[si + 1] = g2;
    out[si + 2] = b2;
    out[si + 3] = a;
  }

  return {
    ...image,
    data: out,
    displayColorSpace: to,
  } as FloatImageData & { displayColorSpace: DisplayColorSpace };
}

/**
 * Convert display-referred Float32Array to linear FloatImageData.
 * Primaries are determined by the display space.
 */
export function convertDisplayToLinear(
  data: Float32Array,
  width: number,
  height: number,
  from: DisplayColorSpace,
  linearColorSpace: LinearColorSpace,
): FloatImageData {
  const fromCh = getChromaticitiesForDisplay(from);
  const toCh = getChromaticitiesForLinear(linearColorSpace);
  const matrix = buildLinearToLinearMatrix(fromCh, toCh);

  const linearData = new Float32Array(data.length);
  const pixelCount = width * height;

  for (let i = 0; i < pixelCount; i++) {
    const si = i * 4;
    const r = data[si] ?? 0;
    const g = data[si + 1] ?? 0;
    const b = data[si + 2] ?? 0;
    const a = data[si + 3] ?? 1;

    const [rLinear, gLinear, bLinear] = displayToLinear(r, g, b, from);
    const [r2, g2, b2] = applyMatrix3(rLinear, gLinear, bLinear, matrix);

    linearData[si] = r2;
    linearData[si + 1] = g2;
    linearData[si + 2] = b2;
    linearData[si + 3] = a;
  }

  return {
    width,
    height,
    data: linearData,
    linearColorSpace,
  };
}
