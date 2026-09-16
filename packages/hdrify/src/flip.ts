import type { HdrifyImage } from './hdrifyImage.js';

export interface FlipImageOptions {
  /** Horizontal axis: 1 (default, unchanged) or -1 (mirror left-right). */
  x?: 1 | -1;
  /** Vertical axis: 1 (default, unchanged) or -1 (mirror top-bottom). */
  y?: 1 | -1;
}

/**
 * Flip an HdrifyImage along either axis (or both), returning a new image with a freshly
 * allocated buffer. `{ y: -1 }` mirrors top-to-bottom — the transform some decoders (e.g. three.js's
 * EXRLoader) apply during decode to land in a bottom-origin texture convention, so the same
 * effect can be reproduced without one.
 */
export function flipImage(image: HdrifyImage, options: FlipImageOptions = {}): HdrifyImage {
  const { x = 1, y = 1 } = options;
  if (x !== 1 && x !== -1) throw new Error(`flipImage: x must be 1 or -1, got ${x}`);
  if (y !== 1 && y !== -1) throw new Error(`flipImage: y must be 1 or -1, got ${y}`);

  const { width, height, data } = image;
  const out = new Float32Array(data.length);
  const rowFloats = width * 4;

  if (x === 1) {
    // No horizontal mirror: each row can be copied as a single contiguous block.
    for (let row = 0; row < height; row++) {
      const srcRow = y === -1 ? height - 1 - row : row;
      out.set(data.subarray(srcRow * rowFloats, srcRow * rowFloats + rowFloats), row * rowFloats);
    }
  } else {
    for (let row = 0; row < height; row++) {
      const srcRowOffset = (y === -1 ? height - 1 - row : row) * rowFloats;
      const dstRowOffset = row * rowFloats;
      for (let col = 0; col < width; col++) {
        const srcOffset = srcRowOffset + (width - 1 - col) * 4;
        const dstOffset = dstRowOffset + col * 4;
        out[dstOffset] = data[srcOffset]!;
        out[dstOffset + 1] = data[srcOffset + 1]!;
        out[dstOffset + 2] = data[srcOffset + 2]!;
        out[dstOffset + 3] = data[srcOffset + 3]!;
      }
    }
  }

  return { width, height, data: out, linearColorSpace: image.linearColorSpace, metadata: image.metadata };
}
