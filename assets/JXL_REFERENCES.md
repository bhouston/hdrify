# JPEG XL reference images

These full-size files were encoded from the existing EXR assets with the official
[JPEG XL reference encoder, `cjxl`](https://github.com/libjxl/libjxl), version
**0.12.0**, independently of HDRify's encoder. They inherit their source images'
provenance and licensing; this conversion does not introduce new image content.

| JPEG XL file             | Source                   | Encoding                                  | Dimensions | Linear color space |
| ------------------------ | ------------------------ | ----------------------------------------- | ---------- | ------------------ |
| `memorial.jxl`           | `memorial.exr`           | Lossless Modular, container               | 512 × 768  | Rec.709            |
| `memorial_lossy.jxl`     | `memorial.exr`           | Lossy VarDCT, bare codestream, distance 1 | 512 × 768  | Rec.709            |
| `reference_gradient.jxl` | `reference_gradient.exr` | Lossless Modular, container               | 512 × 512  | Rec.709            |
| `reference_cie.jxl`      | `reference_cie.exr`      | Lossless Modular, container               | 512 × 512  | Rec.2020           |

The official encoder reads each EXR's chromaticities and floating-point samples
directly. All files retain 16-bit floating-point sample declarations. The lossless
files preserve the decoded EXR samples exactly, including alpha. `memorial.jxl`
contains RGB values up to 274; `reference_cie.jxl` reaches 732. The gradient is an
SDR-range precision reference (maximum 1), rather than an HDR brightness test.

## Reproduce

Install the official tools (`brew install jpeg-xl` on macOS), then run from the repository root:

```sh
scripts/generate-jxl-references.sh
```

The commands use `-d 0 -e 7 --container=1` for the lossless references and
`-d 1 -e 7 --container=0` for `memorial_lossy.jxl`. There is no resizing, tone mapping,
SDR conversion or call to `writeJxl`. Encoder upgrades can produce different bytes;
the hashes below record the committed 0.12.0 files.

Inspect or decode using the independent reference tools:

```sh
jxlinfo assets/memorial.jxl
djxl assets/memorial.jxl /tmp/memorial-decoded.pfm
```

The smaller codec feature corpus in `assets/jxl/` has a separate generator,
`scripts/generate-jxl-assets.sh`; regenerating it leaves these references untouched.

## SHA-256

| File                     | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `memorial.exr`           | `46337f0879c25cad700c45fc92e456033d77543f18b52ff747f70ce5461ca178` |
| `reference_gradient.exr` | `b574562009b19dd919b61a289091819852fcca3896998573002e25142adf8b17` |
| `reference_cie.exr`      | `2766f6db1a462b6b24889cfdb9beed851bb1f2bdb542dd416866dcab772b2cc3` |
| `memorial.jxl`           | `7d8cf1252b80b58263d509b9b2b011387bdaf43847e941134ad7d5b3ac5bc924` |
| `memorial_lossy.jxl`     | `62f63cc9a1622c6d8383deff394a3a1b3b7e49e6545bf667e9e1a45538f5fc92` |
| `reference_gradient.jxl` | `883e7e08e48611e4fd3092460dfe2d038f29c65a6d0d7fea685bd7acdfaf6f7d` |
| `reference_cie.jxl`      | `23c5a3e8d020d7aaff91d674b7f090a310fc771494bf1574368d66bac636c60a` |
