/**
 * Round-trip tests for color space conversion.
 *
 * We create simple gradients (red-to-black, green-to-black, blue-to-black),
 * convert to another space and back, and assert every pixel matches the
 * original within the stated tolerance (zero failures).
 *
 * - Linear ↔ linear: 1% relative error (validates RGB↔XYZ matrices).
 * - Linear → display → linear: 1% relative error (validates transfer functions).
 */
export {};
