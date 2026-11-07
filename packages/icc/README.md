# hdrify-icc

Pure TypeScript ICC v2/v4 binary reader and writer, usable in browsers and Node.js.
`readIccProfile` and `writeIccProfile` preserve unknown tag payloads when editing profiles.
`readIccRgbTransform` interprets RGB matrix/TRC display profiles, including curve tables and
parametric types 0–4. Matrices map to the D50 PCS; `chad` has already been applied to colorants.
`readIccCicp` reads HDR colour identification independently of legacy LUT tags.

This is an initial ICC implementation, not a complete colour management system. LUT transforms,
CMYK and gray profiles are unsupported. Callers must handle an undefined transform explicitly.
Writing rebuilds offsets/alignment and clears the old profile ID; it does not compute an MD5 ID.
