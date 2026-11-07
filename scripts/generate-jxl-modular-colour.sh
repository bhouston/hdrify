#!/usr/bin/env bash
# Crafted Modular YCbCr corpus. Requires pnpm dependencies and djxl.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/jxl/modular-colour
GENERATE_MODULAR_COLOUR=1 pnpm vitest run packages/hdrify/src/jxl/jxlModularColour.test.ts --no-coverage
for mode in 444 420 422 440; do
  djxl "assets/jxl/modular-colour/modular_ycbcr$mode.jxl" "assets/jxl/modular-colour/modular_ycbcr$mode.ref.pfm" --quiet
done
