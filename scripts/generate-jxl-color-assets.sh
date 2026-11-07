#!/usr/bin/env bash
# Reproducible colour oracle fixtures. Requires libjxl (cjxl/djxl), Python 3 and ImageMagick.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/jxl/color"
SRC="$(mktemp -d)"
trap 'rm -rf "$SRC"' EXIT
mkdir -p "$OUT"
python3 - "$SRC/input.ppm" <<'PY'
import struct, sys
with open(sys.argv[1], 'wb') as f:
    f.write(b'P6\n8 4\n65535\n')
    for y in range(4):
        for x in range(8):
            for v in [(x+1)/10, (y+1)/6, (x+y+1)/14]:
                f.write(struct.pack('>H', round(v*65535)))
PY
for spec in 'pq RGB_D65_202_Rel_PeQ' 'hlg RGB_D65_202_Rel_HLG'; do
  read -r name encoding <<< "$spec"
  for distance in 0 1; do
    cjxl "$SRC/input.ppm" "$OUT/$name-d$distance.jxl" --quiet -d "$distance" -x "color_space=$encoding"
    djxl "$OUT/$name-d$distance.jxl" "$OUT/$name-d$distance.ref.pfm" --quiet --color_space=RGB_D65_202_Rel_Lin
  done
done
