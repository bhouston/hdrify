/**
 * Sanitize float buffer in-place: set any negative or non-finite value to 0.
 * Used after loading and before saving/encoding so pipelines can assume non-negative finite data.
 *
 * @param data - Float32Array to mutate
 */
export function ensureNonNegativeFinite(data) {
    for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v === undefined || v < 0 || !Number.isFinite(v))
            data[i] = 0;
    }
}
//# sourceMappingURL=hdrifyImage.js.map