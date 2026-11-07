// Reference fixtures for orientation, associated alpha, extra channels and animation.
// Build: c++ scripts/generate-jxl-decoder-assets.cc $(pkg-config --cflags --libs libjxl) -o /tmp/jxl-fixtures
// Run from repository root: /tmp/jxl-fixtures
#include <jxl/encode.h>
#include <jxl/decode.h>
#include <jxl/color_encoding.h>
#include <cassert>
#include <cstdio>
#include <string>
#include <vector>

static void Check(JxlEncoderStatus status) { assert(status == JXL_ENC_SUCCESS); }
static void Encode(const std::string& name, int orientation, bool alpha, bool extra, bool animation, bool spot = false, bool rec2020 = false) {
  JxlEncoder* enc = JxlEncoderCreate(nullptr);
  JxlBasicInfo info;
  JxlEncoderInitBasicInfo(&info);
  info.xsize = 3; info.ysize = 2; info.bits_per_sample = 32; info.exponent_bits_per_sample = 8;
  info.uses_original_profile = JXL_TRUE;
  info.orientation = static_cast<JxlOrientation>(orientation);
  info.num_extra_channels = (alpha ? 1 : 0) + (extra ? 2 : 0) + (spot ? 1 : 0);
  if (alpha) { info.alpha_bits = 32; info.alpha_exponent_bits = 8; info.alpha_premultiplied = JXL_TRUE; }
  info.have_animation = animation;
  if (animation) { info.animation.tps_numerator = 1000; info.animation.tps_denominator = 1; info.animation.num_loops = 3; info.animation.have_timecodes = JXL_TRUE; }
  Check(JxlEncoderSetBasicInfo(enc, &info));
  JxlColorEncoding color;
  JxlColorEncodingSetToLinearSRGB(&color, JXL_FALSE);
  if (rec2020) color.primaries = JXL_PRIMARIES_2100;
  Check(JxlEncoderSetColorEncoding(enc, &color));
  if (extra) for (int i = 0; i < 2; i++) {
    JxlExtraChannelInfo ec; JxlEncoderInitExtraChannelInfo(i == 0 ? JXL_CHANNEL_DEPTH : JXL_CHANNEL_SELECTION_MASK, &ec);
    ec.bits_per_sample = 32; ec.exponent_bits_per_sample = 8;
    Check(JxlEncoderSetExtraChannelInfo(enc, i, &ec));
    const char* name = i == 0 ? "Z" : "selection";
    Check(JxlEncoderSetExtraChannelName(enc, i, name, i == 0 ? 1 : 9));
  }
  if (spot) {
    JxlExtraChannelInfo ec; JxlEncoderInitExtraChannelInfo(JXL_CHANNEL_SPOT_COLOR, &ec);
    ec.bits_per_sample = 32; ec.exponent_bits_per_sample = 8;
    ec.spot_color[0] = 0.25f; ec.spot_color[1] = 0.75f; ec.spot_color[2] = 0.5f; ec.spot_color[3] = 0.625f;
    Check(JxlEncoderSetExtraChannelInfo(enc, 0, &ec));
    Check(JxlEncoderSetExtraChannelName(enc, 0, "ink", 3));
  }
  auto* settings = JxlEncoderFrameSettingsCreate(enc, nullptr);
  Check(JxlEncoderSetFrameLossless(settings, JXL_TRUE));
  JxlPixelFormat pixels = {static_cast<uint32_t>(alpha ? 4 : 3), JXL_TYPE_FLOAT, JXL_NATIVE_ENDIAN, 0};
  for (int frame = 0; frame < (animation ? 3 : 1); frame++) {
    if (animation) {
      JxlFrameHeader fh; JxlEncoderInitFrameHeader(&fh);
      fh.duration = frame == 0 ? 25 : frame == 1 ? 100 : 250;
      fh.timecode = frame == 0 ? 0x01020304 : frame == 1 ? 0x01020305 : 0x01020306;
      Check(JxlEncoderSetFrameHeader(settings, &fh));
    }
    std::vector<float> data;
    for (int i = 0; i < 6; i++) {
      float a = i == 0 ? 0 : i == 1 ? 0.0000001f : i / 5.0f;
      for (int c = 0; c < 3; c++) data.push_back((i + 1 + c + frame) / 16.0f * (alpha ? a : 1));
      if (alpha) data.push_back(a);
    }
    Check(JxlEncoderAddImageFrame(settings, &pixels, data.data(), data.size() * sizeof(float)));
    if (extra) {
      JxlPixelFormat plane = {1, JXL_TYPE_FLOAT, JXL_NATIVE_ENDIAN, 0};
      const float depth[] = {0, 1, 2, 3, 4, 5};
      const float mask[] = {1, 0, 1, 0, 1, 0};
      Check(JxlEncoderSetExtraChannelBuffer(settings, &plane, depth, sizeof(depth), 0));
      Check(JxlEncoderSetExtraChannelBuffer(settings, &plane, mask, sizeof(mask), 1));
    }
    if (spot) {
      JxlPixelFormat plane = {1, JXL_TYPE_FLOAT, JXL_NATIVE_ENDIAN, 0};
      const float ink[] = {0, 0.25f, 0.5f, 0.75f, 1, 0.125f};
      Check(JxlEncoderSetExtraChannelBuffer(settings, &plane, ink, sizeof(ink), 0));
    }
  }
  JxlEncoderCloseInput(enc);
  std::vector<uint8_t> output(65536); uint8_t* next = output.data(); size_t avail = output.size();
  Check(JxlEncoderProcessOutput(enc, &next, &avail));
  FILE* f = fopen(("assets/jxl/features/" + name + ".jxl").c_str(), "wb"); assert(f);
  fwrite(output.data(), 1, output.size() - avail, f); fclose(f);
  if (alpha && !animation) {
    // djxl drops alpha for PFM without unpremultiplying. Request straight alpha via the public API.
    JxlDecoder* dec = JxlDecoderCreate(nullptr);
    assert(JxlDecoderSetUnpremultiplyAlpha(dec, JXL_TRUE) == JXL_DEC_SUCCESS);
    assert(JxlDecoderSubscribeEvents(dec, JXL_DEC_BASIC_INFO | JXL_DEC_FULL_IMAGE) == JXL_DEC_SUCCESS);
    assert(JxlDecoderSetInput(dec, output.data(), output.size() - avail) == JXL_DEC_SUCCESS);
    JxlDecoderCloseInput(dec);
    std::vector<float> decoded(24);
    JxlPixelFormat rgba = {4, JXL_TYPE_FLOAT, JXL_NATIVE_ENDIAN, 0};
    for (;;) {
      auto status = JxlDecoderProcessInput(dec);
      if (status == JXL_DEC_SUCCESS) break;
      if (status == JXL_DEC_NEED_IMAGE_OUT_BUFFER)
        assert(JxlDecoderSetImageOutBuffer(dec, &rgba, decoded.data(), decoded.size() * sizeof(float)) == JXL_DEC_SUCCESS);
      else assert(status == JXL_DEC_BASIC_INFO || status == JXL_DEC_FULL_IMAGE);
    }
    FILE* ref = fopen(("assets/jxl/features/" + name + ".ref.pfm").c_str(), "wb");
    fprintf(ref, "PF\n3 2\n-1.0\n");
    for (int y = 1; y >= 0; y--) for (int x = 0; x < 3; x++) fwrite(&decoded[(y * 3 + x) * 4], sizeof(float), 3, ref);
    fclose(ref);
    JxlDecoderDestroy(dec);
  }
  JxlEncoderDestroy(enc);
}
int main() {
  for (int o = 1; o <= 8; o++) Encode("orientation" + std::to_string(o), o, false, false, false);
  Encode("associated_alpha", 1, true, false, false);
  Encode("extra_channels", 6, false, true, false);
  Encode("animation_timing", 1, false, false, true);
  Encode("spot_color", 1, false, false, false, true);
  Encode("widegamut_animation", 6, true, false, true, false, true);
}
