# HDR Banding Investigation: Where Does the Banding Come From?

## Summary

Banding in `reference_cie.hdr` comes from **two sources**:

1. **Format limitation (primary)**: RGBE has ~8 bits of mantissa per channel, so smooth gradients are quantized to ~256 discrete levels.
2. **Reader bug (secondary)**: The HDR reader uses floor restoration instead of midpoint restoration, roughly **doubling** the error.

## Isolating Writer vs Reader

### Round-trip test

```ts
original → writeHdr() → HDR bytes → readHdr() → decoded
```

Any difference between `original` and `decoded` comes from the round-trip. The writer quantizes (float → RGBE); the reader decodes (RGBE → float). Both are involved.

### Verifying encode/decode symmetry

To isolate reader vs writer:

1. **Writer output** is correct if: applying our `floatToRGBE` then a correct decode yields values that round-trip losslessly (within the format’s precision).
2. **Reader output** is correct if: it decodes the written RGBE bytes the same way a reference implementation would.

The `referenceCieBandingDiagnostic.test.ts` runs a symmetric round-trip to check whether writer and reader are consistent.

## Root Cause: Reader Uses Floor Restoration

From [C. Bloom’s article](https://cbloomrants.blogspot.com/2020/06/widespread-error-in-radiance-hdr-rgbe.html):

- **Bad decode** (what many implementations do): `value = byte * scale`
- **Correct decode** (Greg Ward’s Radiance): `value = (byte + 0.5) * scale`

When quantizing to 8 bits, each byte represents a range. Restoring with `byte * scale` maps to the bottom of that range (“floor restoration”). The Radiance reference uses `(byte + 0.5) * scale` to map to the center, reducing error.

Our reader (`readHdr.ts`, `RGBEByteToRGBFloat`):

```ts
const scale = 2.0 ** (e - 128.0) / 255.0;
destArray[destOffset + 0] = sourceArray[sourceOffset + 0]! * scale;  // no +0.5
```

So we use floor restoration. The article reports:

- Correct (midpoint) decode: ~0.39% max relative error
- Floor-floor decode: ~0.78% max relative error

So our reader likely contributes roughly double the error vs the reference.

## Writer

- Uses `Math.floor((r / factor) * 255 + 0.5)` → round-to-nearest (centered quantization).
- This matches typical “centered quantizer” usage.
- Quantization itself is inherent to the RGBE format (8 bits) and will always introduce banding on smooth gradients.

## Recommendation

1. **Fix the reader**: change decode to use `(byte + 0.5) * scale` for the mantissas, matching Radiance.
2. **Accept format limits**: RGBE will still band on very smooth gradients; the 0.5 bias only reduces the error magnitude.
