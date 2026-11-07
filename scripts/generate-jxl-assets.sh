#!/usr/bin/env bash
# Regenerates the JPEG XL test corpus in assets/jxl/ with libjxl's cjxl/djxl (reference implementation)
# and OpenImageIO's oiiotool. Each <name>.jxl gets a <name>.ref.<ext> decoded by djxl, which tests use as
# the oracle (PFM rows are stored bottom-to-top). Requires: cjxl, djxl, oiiotool (brew install jpeg-xl openimageio).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/jxl"
SRC="$(mktemp -d)"
trap 'rm -rf "$SRC"' EXIT
mkdir -p "$OUT"
rm -f "$OUT"/*.jxl "$OUT"/*.ref.*

A="$ROOT/assets"
oiiotool "$A/memorial.exr" --resize 64x96 -d float -o "$SRC/hdr.pfm"
oiiotool "$A/memorial.exr" --resize 64x96 -d half -o "$SRC/hdr_half.exr"
oiiotool "$A/blouberg_sunrise_2_1k.jpg" --resize 96x48 -d uint8 -o "$SRC/rgb8.ppm"
oiiotool "$A/blouberg_sunrise_2_1k.jpg" --resize 96x48 -d uint16 -o "$SRC/rgb16.ppm"
oiiotool "$A/blouberg_sunrise_2_1k.jpg" --resize 96x48 --ch R -d uint8 -o "$SRC/gray8.pgm"
oiiotool "$A/reference_cie.exr" --resize 64x64 --ch R,G,B,A -d uint8 -o "$SRC/rgba8.png"
oiiotool "$A/blouberg_sunrise_2_1k.jpg" --resize 300x150 -d uint8 -o "$SRC/big8.ppm"
oiiotool "$A/blouberg_sunrise_2_1k.jpg" --resize 301x151 -d uint8 -o "$SRC/odd8.ppm"
oiiotool --pattern checker:width=8:height=8:color1=1,0,0:color2=0,0.5,1 40x24 3 -d uint8 -o "$SRC/palette8.ppm"

# name  source  ref-extension  cjxl flags...
enc() {
  local name="$1" src="$2" ext="$3"
  shift 3
  cjxl "$SRC/$src" "$OUT/$name.jxl" --quiet "$@"
  local bits=()
  [[ "$ext" == ppm16 ]] && bits=(--bits_per_sample=16) && ext=ppm
  [[ "$ext" == pam16 ]] && bits=(--bits_per_sample=16) && ext=pam
  djxl "$OUT/$name.jxl" "$OUT/$name.ref.$ext" --quiet ${bits[@]+"${bits[@]}"}
}

# --- Lossless Modular ---
enc lossless_rgb8 rgb8.ppm ppm -d 0 -e 7
enc lossless_rgb8_e1 rgb8.ppm ppm -d 0 -e 1
enc lossless_rgb8_e9 rgb8.ppm ppm -d 0 -e 9
enc lossless_rgb8_container rgb8.ppm ppm -d 0 --container=1
enc lossless_rgb16 rgb16.ppm ppm16 -d 0
enc lossless_gray8 gray8.pgm pgm -d 0
enc lossless_rgba8 rgba8.png pam -d 0
enc lossless_float32 hdr.pfm pfm -d 0 -x color_space=RGB_D65_SRG_Rel_Lin
enc lossless_float16 hdr_half.exr pfm -d 0
enc lossless_palette palette8.ppm ppm -d 0
enc lossless_squeeze rgb8.ppm ppm -d 0 -R 1
enc lossless_multigroup big8.ppm ppm -d 0 -g 0

# --- Lossy Modular (XYB + squeeze) ---
enc lossy_modular rgb8.ppm pfm -m 1 -d 1

# --- VarDCT ---
enc vardct_rgb8 rgb8.ppm pfm -d 1
enc vardct_float hdr.pfm pfm -d 1 -x color_space=RGB_D65_SRG_Rel_Lin
enc vardct_rgba8 rgba8.png pam16 -d 1
enc vardct_nofilters rgb8.ppm pfm -d 1 --epf=0 --gaborish=0
enc vardct_progressive rgb8.ppm pfm -d 1 -p
enc vardct_odd_multigroup odd8.ppm pfm -d 2
enc vardct_resampling rgb8.ppm pfm -d 4 --resampling=2
enc vardct_noise rgb8.ppm pfm -d 1 --photon_noise_iso=3200

ls -la "$OUT"

# --- Embedded ICC profile (want_icc) ---
# icc_rec2020_pq.icc is a libjxl-synthesized profile (Rec.2020 primaries, PQ); the .jxl embeds it verbatim,
# so a decoder's reconstructed ICC bytes must equal the .icc file.
oiiotool "$A/blouberg_sunrise_2_1k.jpg" --resize 16x8 -d uint8 -o "$SRC/icc_base.png"
cjxl "$SRC/icc_base.png" "$SRC/icc_tmp.jxl" --quiet -d 0 -x color_space=RGB_D65_202_Rel_PeQ
djxl "$SRC/icc_tmp.jxl" "$SRC/icc_tmp.png" --quiet --icc_out="$OUT/icc_rec2020_pq.icc"
cjxl "$SRC/icc_base.png" "$OUT/icc_rec2020_pq.jxl" --quiet -d 0 -x icc_pathname="$OUT/icc_rec2020_pq.icc"
