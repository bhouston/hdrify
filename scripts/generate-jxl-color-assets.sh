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
for spec in 'pq RGB_D65_202_Rel_PeQ' 'hlg RGB_D65_202_Rel_HLG' 'p3_dci RGB_DCI_DCI_Rel_Lin' 'equal_energy RGB_EER_SRG_Rel_Lin' 'custom RGB_D50_Ado_Rel_Lin'; do
  read -r name encoding <<< "$spec"
  for distance in 0 1; do
    cjxl "$SRC/input.ppm" "$OUT/$name-d$distance.jxl" --quiet -d "$distance" -x "color_space=$encoding"
    djxl "$OUT/$name-d$distance.jxl" "$OUT/$name-d$distance.ref.pfm" --quiet --color_space=RGB_D65_202_Rel_Lin
  done
done
for spec in 'display_p3 RGB_D65_DCI_Rel_SRG' 'adobe_rgb RGB_D65_Ado_Rel_Ado' 'prophoto RGB_D50_Pro_Rel_Pro' 'pq_icc RGB_D65_202_Rel_PeQ'; do
  read -r name encoding <<< "$spec"
  cjxl "$SRC/input.ppm" "$SRC/profile.jxl" --quiet -d 0 -x "color_space=$encoding"
  # Explicitly retain the desired output encoding; djxl otherwise synthesizes an sRGB output profile.
  djxl "$SRC/profile.jxl" "$SRC/profile.pfm" --quiet --color_space="$encoding" --icc_out="$OUT/$name.icc"
  for distance in 0 1; do
    cjxl "$SRC/input.ppm" "$OUT/$name-d$distance.jxl" --quiet -d "$distance" -x "icc_pathname=$OUT/$name.icc"
    djxl "$OUT/$name-d$distance.jxl" "$OUT/$name-d$distance.ref.pfm" --quiet --color_space=RGB_D65_202_Rel_Lin
  done
done
magick -size 8x4 xc:'#3070a0' "$SRC/layer0.png"
magick "$SRC/layer0.png" -fill '#b08030' -draw 'rectangle 2,1 4,2' "$SRC/layer1.png"
magick -delay 0 "$SRC/layer0.png" -delay 10 "$SRC/layer1.png" -loop 0 -layers Optimize "$SRC/layers.gif"
for spec in 'p3_layers RGB_D65_DCI_Rel_SRG' 'pq_layers RGB_D65_202_Rel_PeQ' 'hlg_layers RGB_D65_202_Rel_HLG' 'custom_layers RGB_D50_Ado_Rel_Ado'; do
  read -r name encoding <<< "$spec"
  cjxl "$SRC/layers.gif" "$OUT/$name.jxl" --quiet -d 1 -x "color_space=$encoding"
  # libjxl requires composition in the original encoding; PFM therefore contains encoded RGB here.
  djxl "$OUT/$name.jxl" "$OUT/$name.ref.pfm" --quiet
 done
