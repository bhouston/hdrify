/**
 * Color space conversion utilities.
 * convertFloat32ToLinearColorSpace returns original data when no conversion needed.
 */

import type { FloatImageData } from '../floatImage.js';
import type { DisplayColorSpace, LinearColorSpace } from './colorSpaces.js';
import { DISPLAY_TO_LINEAR } from './colorSpaces.js';
import { applyMatrix3, getLinearToLinearMatrix, mat3ToArray } from './matrixConversion.js';
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
  const matrix = getLinearToLinearMatrix(from, to);
  if (matrix === null) {
    return data;
  }

  const out = new Float32Array(data.length);
  out.set(data);
  const m = mat3ToArray(matrix);
  for (let i = 0; i < data.length; i += 4) {
    applyMatrix3(m, data, out, i, i);
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
  const targetLinear = DISPLAY_TO_LINEAR[to];
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
    // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by data.length loop
    const r = linearData[si]!;
    const g = linearData[si + 1]!;
    const b = linearData[si + 2]!;
    const a = linearData[si + 3]!;
    // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by data.length loop

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
  const fromLinear = DISPLAY_TO_LINEAR[from];
  const matrix = getLinearToLinearMatrix(fromLinear, linearColorSpace);

  const linearData = new Float32Array(data.length);
  const pixelCount = width * height;

  const m = matrix !== null ? mat3ToArray(matrix) : null;
  for (let i = 0; i < pixelCount; i++) {
    const si = i * 4;
    // biome-ignore-start lint/style/noNonNullAssertion: indices bounds-checked by data.length loop
    const r = data[si]!;
    const g = data[si + 1]!;
    const b = data[si + 2]!;
    const a = data[si + 3]!;
    // biome-ignore-end lint/style/noNonNullAssertion: indices bounds-checked by data.length loop

    const [rLinear, gLinear, bLinear] = displayToLinear(r, g, b, from);
    linearData[si] = rLinear;
    linearData[si + 1] = gLinear;
    linearData[si + 2] = bLinear;
    linearData[si + 3] = a;
    if (m !== null) {
      applyMatrix3(m, linearData, linearData, si, si);
    }
  }

  return {
    width,
    height,
    data: linearData,
    linearColorSpace,
  };
}
