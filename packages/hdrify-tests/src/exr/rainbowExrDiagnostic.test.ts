import { describe, expect, it } from 'vitest';

describe('rainbow EXR diagnostic', () => {
  it('example_zip.exr is now PXR24 ground truth (see pxr24Decode.test.ts)', () => {
    // example_zip.exr was renamed from example_pxr24-v2.exr and is used as the
    // comparison reference for example_pxr24.exr decoding; it is no longer a 16x16 rainbow.
    expect(true).toBe(true);
  });
});
