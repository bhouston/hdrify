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
enc lossy_modular_gray gray8.pgm pfm -m 1 -d 1

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

# --- Frame features and multi-frame composition (jxlFeatures / jxlRender). Also requires ImageMagick. ---
# Written to assets/jxl/features/ (the header corpus tests enumerate assets/jxl/*.jxl).
FEAT="$OUT/features"
mkdir -p "$FEAT"
rm -f "$FEAT"/*
# Patches: repeated glyph-like marks so cjxl's patch heuristics fire; referenceOnly frame + kAdd/... patches.
glyphs=()
for y in 4 18 32; do
  for x in 4 16 28 40 52 64 76; do
    glyphs+=(-draw "rectangle $x,$y $((x + 1)),$((y + 7))" -draw "rectangle $((x + 2)),$((y + 3)) $((x + 5)),$((y + 4))"
      -draw "point $((x + 6)),$((y + 1))")
  done
done
magick -size 96x48 xc:white -fill black "${glyphs[@]}" "$SRC/text.png"
magick -size 96x48 xc:'rgba(40,80,200,0.25)' -fill 'rgba(0,0,0,0.9)' "${glyphs[@]}" "$SRC/text_rgba.png"
OUT="$FEAT" enc patches_text text.png ppm -d 0 -e 7 --patches=1
OUT="$FEAT" enc patches_text_rgba text_rgba.png pam -d 0 -e 7 --patches=1
# Animation: GIF with optimized (cropped, alpha-blended) frames; one coalesced reference per frame.
magick -size 32x24 xc:'#204060' -fill '#ff8000' -draw 'rectangle 2,2 10,10' "$SRC/f0.png"
magick "$SRC/f0.png" -fill '#00ff80' -draw 'rectangle 12,6 20,14' "$SRC/f1.png"
magick "$SRC/f1.png" -fill '#8000ff' -draw 'circle 24,16 28,18' "$SRC/f2.png"
magick -delay 10 "$SRC/f0.png" "$SRC/f1.png" "$SRC/f2.png" -loop 0 -layers Optimize "$SRC/anim.gif"
cjxl "$SRC/anim.gif" "$FEAT/anim_gif.jxl" --quiet -d 0
djxl "$FEAT/anim_gif.jxl" "$SRC/anim.pam" --quiet --output_frames
for i in 0 1 2; do mv "$SRC/anim.pam-$i.pam" "$FEAT/anim_gif.ref$i.pam"; done
# Noise and splines (cjxl never emits splines): crafted by the test suite, decoded by djxl.
(cd "$ROOT" && JXL_CRAFT_OUT="$FEAT" npx vitest run packages/hdrify/src/jxl/jxlFeatures.test.ts -t 'writes the crafted' >/dev/null)
djxl "$FEAT/noise_crafted.jxl" "$FEAT/noise_crafted.ref.pfm" --quiet
djxl "$FEAT/splines_crafted.jxl" "$FEAT/splines_crafted.ref.pfm" --quiet

# --- VarDCT coverage: raw (JPEG) quant tables + YCbCr + LF contexts, large DCTs, custom block contexts ---
oiiotool "$SRC/rgb8.ppm" --attrib jpeg:subsampling 4:4:4 --attrib Compression jpeg:85 -o "$SRC/rgb8_444.jpg"
oiiotool --pattern fill:topleft=0.1,0.2,0.8:topright=0.9,0.5,0.1:bottomleft=0.2,0.9,0.3:bottomright=0.5,0.1,0.6 128x128 3 \
  -d uint8 -o "$SRC/grad128.ppm"
enc vardct_jpeg444 rgb8_444.jpg pfm --lossless_jpeg=1
enc vardct_grad128 grad128.ppm pfm -d 4 -e 7
enc vardct_d01 rgb8.ppm pfm -d 0.1 -e 7
# JPEG recompression with 4:2:0 chroma subsampling at an odd size (chroma upsampling, mirrored edges).
oiiotool "$A/blouberg_sunrise_2_1k.jpg" --resize 101x53 -d uint8 -o "$SRC/odd101.ppm"
oiiotool "$SRC/odd101.ppm" --attrib jpeg:subsampling 4:2:0 --attrib Compression jpeg:85 -o "$SRC/odd_420.jpg"
enc vardct_jpeg420 odd_420.jpg pfm --lossless_jpeg=1

# --- Multi-frame decoding through readJxl: lossy (XYB VarDCT) patches, and a zero-duration full-size layer
# composited with a cropped, alpha-blended frame (djxl writes the first displayed frame by default). ---
magick -size 96x48 xc:'#d0e0ff' -fill '#802020' "${glyphs[@]}" "$SRC/text_color.png"
cjxl "$SRC/text_color.png" "$FEAT/patches_lossy.jxl" --quiet -d 1 -e 7 --patches=1
djxl "$FEAT/patches_lossy.jxl" "$FEAT/patches_lossy.ref.pfm" --quiet
magick -delay 0 "$SRC/f0.png" -delay 10 "$SRC/f1.png" "$SRC/f2.png" -loop 0 -layers Optimize "$SRC/layered.gif"
cjxl "$SRC/layered.gif" "$FEAT/layered.jxl" --quiet -d 0
djxl "$FEAT/layered.jxl" "$FEAT/layered.ref.pam" --quiet
cjxl "$SRC/layered.gif" "$FEAT/layered_lossy.jxl" --quiet -d 1
djxl "$FEAT/layered_lossy.jxl" "$FEAT/layered_lossy.ref.pam" --quiet
djxl "$FEAT/layered_lossy.jxl" "$FEAT/layered_lossy.ref.pfm" --quiet

# --- Native TypeScript VarDCT writer: independent decoder oracle used even without djxl in CI. ---
(cd "$ROOT" && JXL_VARDCT_CRAFT_OUT="$FEAT" pnpm vitest run packages/hdrify/src/jxl/writeJxlVardct.test.ts -t 'writes the native VarDCT oracle fixture' --no-coverage >/dev/null)
djxl "$FEAT/native_dct8_hdr.jxl" "$FEAT/native_dct8_hdr.ref.pfm" --quiet

# --- Decoder metadata/output fixtures (requires libjxl development headers and pkg-config). ---
c++ "$ROOT/scripts/generate-jxl-decoder-assets.cc" $(pkg-config --cflags --libs libjxl) -o "$SRC/decoder-fixtures"
(cd "$ROOT" && "$SRC/decoder-fixtures")
for input in "$FEAT"/orientation*.jxl "$FEAT"/extra_channels.jxl "$FEAT"/spot_color.jxl; do
  djxl "$input" "${input%.jxl}.ref.pfm" --quiet
done
# associated_alpha.ref.pfm is emitted by the C API helper with unpremultiplication enabled.
(cd "$ROOT" && JXL_CRAFT_OUT="$FEAT" pnpm exec vitest run packages/hdrify/src/jxl/jxlDecoderGaps.test.ts -t 'writes the crafted preview' >/dev/null)
djxl "$FEAT/preview.jxl" "$FEAT/preview.ref.pfm" --quiet

# HDR transfer-function and colour-management corpus.
bash "$ROOT/scripts/generate-jxl-color-assets.sh"

# Combined Rec.2020, orientation, associated alpha and animation output. PFM drops alpha while
# retaining association, so the oracle is compared using keepPremultipliedAlpha: true.
djxl "$FEAT/widegamut_animation.jxl" "$SRC/widegamut_animation.pfm" --quiet \
  --color_space=RGB_D65_202_Rel_Lin --output_frames
for i in 0 1 2; do mv "$SRC/widegamut_animation.pfm-$i.pfm" "$FEAT/widegamut_animation.ref$i.pfm"; done

# --- EXIF/XMP container boxes (requires exiftool). cjxl copies both from the PNG; metadata_brob wraps them in
# Brotli-compressed brob boxes (the cjxl default). The .exif/.xmp oracles are exiftool's extraction. ---
magick -size 8x8 xc:'#336699' "$SRC/meta.png"
exiftool -q -overwrite_original -EXIF:Artist='hdrify test' -EXIF:Copyright=CC0 -XMP-dc:Title='hdrify xmp' "$SRC/meta.png"
cjxl "$SRC/meta.png" "$FEAT/metadata_boxes.jxl" --quiet -d 0 --compress_boxes=0
cjxl "$SRC/meta.png" "$FEAT/metadata_brob.jxl" --quiet -d 0 --compress_boxes=1
exiftool -b -EXIF "$FEAT/metadata_boxes.jxl" >"$FEAT/metadata_boxes.exif"
exiftool -b -XMP "$FEAT/metadata_boxes.jxl" >"$FEAT/metadata_boxes.xmp"
