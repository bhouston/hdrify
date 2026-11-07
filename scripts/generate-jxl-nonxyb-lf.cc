// Generate the non-XYB progressive corpus with libjxl's C API (cjxl has no colour-transform flag).
// c++ -std=c++17 scripts/generate-jxl-nonxyb-lf.cc $(pkg-config --cflags --libs libjxl) -o /tmp/jxl-lf
// /tmp/jxl-lf assets/jxl/modular-colour
// for level in 1 2; do djxl assets/jxl/modular-colour/nonxyb_lf$level.jxl assets/jxl/modular-colour/nonxyb_lf$level.ref.pfm --quiet; done
#include <jxl/encode.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

static void check(JxlEncoderStatus status) {
  if (status != JXL_ENC_SUCCESS) std::abort();
}
int main(int argc, char** argv) {
  if (argc != 2) return 1;
  const size_t w = 65, h = 67;
  std::vector<float> pixels(w * h * 3);
  for (size_t y = 0; y < h; ++y) for (size_t x = 0; x < w; ++x) {
    pixels[(y * w + x) * 3] = 0.1f + 0.7f * x / w;
    pixels[(y * w + x) * 3 + 1] = 0.2f + 0.6f * y / h;
    pixels[(y * w + x) * 3 + 2] = 0.3f + 0.2f * std::sin((x + y) * 0.3f);
  }
  for (int level : {1, 2}) {
    auto* enc = JxlEncoderCreate(nullptr);
    JxlBasicInfo info;
    JxlEncoderInitBasicInfo(&info);
    info.xsize = w; info.ysize = h;
    info.bits_per_sample = 32; info.exponent_bits_per_sample = 8;
    info.uses_original_profile = JXL_TRUE;
    check(JxlEncoderSetBasicInfo(enc, &info));
    JxlColorEncoding color;
    JxlColorEncodingSetToLinearSRGB(&color, JXL_FALSE);
    check(JxlEncoderSetColorEncoding(enc, &color));
    auto* settings = JxlEncoderFrameSettingsCreate(enc, nullptr);
    check(JxlEncoderSetFrameDistance(settings, 1));
    check(JxlEncoderFrameSettingsSetOption(settings, JXL_ENC_FRAME_SETTING_COLOR_TRANSFORM, 1));
    check(JxlEncoderFrameSettingsSetOption(settings, JXL_ENC_FRAME_SETTING_MODULAR, 0));
    check(JxlEncoderFrameSettingsSetOption(settings, JXL_ENC_FRAME_SETTING_PROGRESSIVE_DC, level));
    JxlPixelFormat format = {3, JXL_TYPE_FLOAT, JXL_NATIVE_ENDIAN, 0};
    check(JxlEncoderAddImageFrame(settings, &format, pixels.data(), pixels.size() * sizeof(float)));
    JxlEncoderCloseInput(enc);
    std::vector<uint8_t> out(1 << 20);
    uint8_t* next = out.data(); size_t avail = out.size();
    check(JxlEncoderProcessOutput(enc, &next, &avail));
    const auto name = std::string(argv[1]) + "/nonxyb_lf" + std::to_string(level) + ".jxl";
    auto* file = std::fopen(name.c_str(), "wb");
    if (!file) return 1;
    std::fwrite(out.data(), 1, out.size() - avail, file);
    std::fclose(file);
    JxlEncoderDestroy(enc);
  }
}
