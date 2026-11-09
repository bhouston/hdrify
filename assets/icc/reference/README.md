# icc reference fixtures

All seven profiles from [lovell/icc's test fixtures](https://github.com/lovell/icc/tree/2b437f3251a61a070b6fc248e66b2be85eee0c95/test/fixtures),
copied unchanged at revision `2b437f3251a61a070b6fc248e66b2be85eee0c95`. See the accompanying upstream
[Apache-2.0 license](LICENSE) and [upstream license terms](https://github.com/lovell/icc/blob/2b437f3251a61a070b6fc248e66b2be85eee0c95/LICENSE).
Embedded third-party copyright notices are preserved; these files are not relicensed under hdrify's MIT license.
`manifest.json` records source URLs, sizes, and SHA-256 hashes.

The upstream [test suite](https://github.com/lovell/icc/blob/2b437f3251a61a070b6fc248e66b2be85eee0c95/test/unit.js)
checks exact metadata for these seven profiles, plus invalid length and signature cases.
Our differential suite checks the same profiles against pinned `icc@4.0.0`, rewrites them,
and compares metadata and all tag payloads again.

| Profile                                | Coverage                                                 |
| -------------------------------------- | -------------------------------------------------------- |
| sRGB_IEC61966-2-1_black_scaled.icc     | Legacy v2 text, model and viewing conditions             |
| sRGB_ICC_v4_Appearance.icc             | RGB with Lab PCS, v4 metadata and LUT preservation       |
| USWebCoatedSWOP.icc                    | Adobe CMYK printer profile                               |
| D65_XYZ.icc                            | HP XYZ profile, v2.4 header                              |
| ILFORD_CANpro-4000_GPGFG_ProPlatin.icc | X-Rite printer profile, multilingual text                |
| Probev1_ICCv2.icc                      | ICC CMYK/Lab test profile, legacy tags                   |
| Probev1_ICCv4.icc                      | ICC v4 test profile, Unicode copyright with terminal NUL |

Additional official profiles are available in the [ICC profile library](https://registry.color.org/profile-library/),
including [Probe profiles](https://registry.color.org/profile-library/probe-profile)
and [sRGB profiles](https://registry.color.org/rgb-registry/srgbprofiles).
Installed macOS profiles are tested from their system location when found and are not copied here.
