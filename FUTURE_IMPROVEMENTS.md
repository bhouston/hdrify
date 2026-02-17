# Future improvements

Ideas documented for later implementation.

## Gain map: quantization-aware rounding (#2)

**Context:** SDR and gain map are stored as 8-bit (0–255). We currently round to nearest: `Math.round(255 * value)`. The decode formula uses these quantized values, so round-trip error comes from both SDR quantization and gain map quantization.

**Improvement:** When choosing the 8-bit values to store, consider quantization errors and pick the values that minimize reconstruction error.

- **SDR:** For each channel, the ideal value is `linearTosRGB(sr) * 255`. Instead of always rounding to nearest, try both `floor` and `ceil` (clamped to 0–255), then for each candidate compute the linear SDR the decoder will see and the gain map that would be stored (given that SDR choice), then run the decode formula and choose the (SDR, gain map) pair that minimizes `|decoded − original|` (per channel or combined).
- **Gain map:** Similarly, for each channel the ideal stored value is `255 * clamped^gamma`. Try floor/ceil of that value (clamped to 0–255), decode with the chosen SDR, and pick the gain map value that gives the smallest error.

A practical approach: (1) Compute SDR bytes as now (round to nearest). (2) Compute gain map using quantized SDR (already done). (3) For each pixel, optionally try the one or two alternative gain map bytes (e.g. ±1) and keep the one that minimizes round-trip error. That avoids a full joint search over SDR and gain map while still reducing gain-map quantization error.

**Benefit:** Smaller round-trip error for a given 8-bit pipeline; potentially allows tighter test tolerances (e.g. 5%) on high-DR assets like memorial.
