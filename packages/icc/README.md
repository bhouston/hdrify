# hdrify-icc

Pure TypeScript ICC v2/v4 binary reader and writer, usable in browsers and Node.js.
`readIccProfile` and `writeIccProfile` preserve unknown tag payloads when editing profiles.
`readIccRgbTransform` interprets RGB matrix/TRC display profiles, including curve tables and
parametric types 0–4. Matrices map to the D50 PCS; `chad` has already been applied to colorants.
`readIccCicp` reads HDR colour identification independently of legacy LUT tags.

`parse(bytes)` returns metadata compatible with npm [`icc` 4.0.0](https://www.npmjs.com/package/icc),
including header names, description, copyright, device model description, viewing conditions
description, and whitepoint. It accepts `Uint8Array` and Node `Buffer`, including sliced views.
`readIccMetadata(profile)` decodes the same metadata from an already parsed or edited profile;
`readIccHeader(header)` decodes just the header.

```ts
import { parse, readIccProfile, writeIccProfile, writeIccLocalizedText } from 'hdrify-icc';

const metadata = parse(bytes);
const profile = readIccProfile(bytes);
profile.tags = profile.tags.filter((tag) => tag.signature !== 'desc');
profile.tags.push({
  signature: 'desc',
  data: writeIccLocalizedText([{ language: 'en', country: 'US', text: 'My edited profile' }]),
});
const editedBytes = writeIccProfile(profile);
```

Metadata codecs support v2 `desc`/`text`, v4 `mluc`, and signed fixed-point `XYZ ` payloads.
Use `readIccTagValue(data)` for the decoded string or XYZ triple, and
`readIccLocalizedText(data)` for all language/country records. The compatible metadata parser
selects the first `mluc` record, and the last supported duplicate tag wins, matching `icc`.
`writeIccDescription`, `writeIccText`, `writeIccLocalizedText`, and `writeIccXyz` author payloads
for the binary writer. The v2 string writers require ASCII; use `mluc` for Unicode.

Compatibility covers metadata extraction, not colour transforms: `icc` does not implement
transforms or writing. Unknown header versions/intents return `undefined` like `icc`.
Metadata tag fields have a string-or-XYZ union because `icc` decodes by payload type even
when it differs from the usual type of that tag. Unknown tags/types remain opaque in binary I/O.
`parse` requires an exact declared profile length, while `readIccProfile` permits trailing
container bytes. Metadata codecs validate tag-local bounds and Unicode; malformed inputs
accepted by `icc` may be rejected. The raw reader/writer can still preserve uninterpreted tags.

The differential suite pins `icc` as a development-only oracle and tests all five checked-in
libjxl profiles, all seven [upstream icc fixtures](../../assets/icc/reference/README.md),
independent v2/v4 metadata fixtures, header mappings, and writer interoperability.
Run `pnpm exec vitest run packages/icc/src`. Installed profiles are automatically discovered
in `/System/Library/ColorSync/Profiles` when present; these optional comparisons are skipped
when no local profiles are available. No macOS profile files are redistributed.
To use another installed or downloaded corpus:

```sh
ICC_COMPAT_CORPUS=/path/to/profiles pnpm exec vitest run packages/icc/src/compatibility.test.ts
```

This is an initial ICC implementation, not a complete colour management system. LUT transforms,
CMYK and gray profiles are unsupported. Callers must handle an undefined transform explicitly.
Writing rebuilds offsets/alignment and clears the old profile ID; it does not compute an MD5 ID.
