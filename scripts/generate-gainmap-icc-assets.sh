#!/usr/bin/env bash
# Reproducible Ultra HDR colour fixtures. Requires Python 3 and libultrahdr's ultrahdr_app built with XMP output:
#   cmake -G Ninja -B build -DUHDR_WRITE_XMP=ON && ninja -C build ultrahdr_app
# Checked-in fixtures: libultrahdr v2.0.2 (5f117294cb70). Pass the ultrahdr_app path as $1 (default: ../libultrahdr/build/ultrahdr_app next to this repository).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/../libultrahdr/build/ultrahdr_app}"
OUT="$ROOT/assets/gainmap"
SRC="$(mktemp -d)"
trap 'rm -rf "$SRC"' EXIT
mkdir -p "$OUT"
# 32x16 linear half-float RGBA ramp with saturated colours (up to 4x SDR white), so gamut and gain both matter.
python3 - "$SRC/hdr.raw" <<'PY'
import struct, sys
with open(sys.argv[1], 'wb') as f:
    for y in range(16):
        for x in range(32):
            s = 4 ** (x / 31)
            f.write(struct.pack('<4e', s * (y % 4 + 1) / 4, s * ((y // 4) + 1) / 4 * (x % 2), s * (1 - y / 16), 1))
PY
# Encode scenario 0: linear Display P3 HDR intent; the tone-mapped SDR base carries a Display P3 ICC profile.
"$APP" -m 0 -p "$SRC/hdr.raw" -a 4 -t 0 -C 1 -w 32 -h 16 -q 95 -Q 95 -z "$OUT/p3.jpg" > /dev/null
# Reference: libultrahdr's linear half-float RGBA decode at full boost, in the base (Display P3) gamut.
"$APP" -m 1 -j "$OUT/p3.jpg" -o 0 -O 4 -z "$OUT/p3.ref.raw" > /dev/null
