#!/usr/bin/env bash
# Full-size HDR references encoded independently of hdrify. Requires libjxl's cjxl/jxlinfo.
# The smaller codec corpus is generated separately by generate-jxl-assets.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/assets"

cjxl --version
# cjxl reads each EXR's linear floating-point samples and chromaticities directly.
# No tone mapping, resizing, SDR quantization or hdrify encoder is used.
for name in memorial reference_gradient reference_cie; do
  cjxl "$ASSETS/$name.exr" "$ASSETS/$name.jxl" \
    -d 0 -e 7 --container=1
  jxlinfo "$ASSETS/$name.jxl"
done
# A lossy VarDCT bare codestream complements the lossless Modular containers.
cjxl "$ASSETS/memorial.exr" "$ASSETS/memorial_lossy.jxl" \
  -d 1 -e 7 --container=0
jxlinfo "$ASSETS/memorial_lossy.jxl"

shasum -a 256 "$ASSETS/memorial.exr" "$ASSETS/reference_gradient.exr" "$ASSETS/reference_cie.exr" \
  "$ASSETS/memorial.jxl" "$ASSETS/memorial_lossy.jxl" "$ASSETS/reference_gradient.jxl" "$ASSETS/reference_cie.jxl"
