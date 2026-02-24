/**
 * In-memory encode → decode round-trip tests (no JPEG).
 *
 * Decode does not need to know the tone mapper: the gain map stores the ratio
 * (HDR_linear / SDR_linear) per pixel, so recovery is (linearize SDR) * gain.
 * We test incrementally: float-only (no quantization), then add SDR quantization,
 * then full quantization, to isolate where precision is lost.
 *
 * Tolerance: compareImages uses decimal 0.01 = 1%. We keep tolerances tight.
 */
export {};
