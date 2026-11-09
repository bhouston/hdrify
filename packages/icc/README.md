# hdrify-icc

Pure TypeScript ICC v2/v4 binary reader and writer, usable in browsers and Node.js.
`readIccProfile` and `writeIccProfile` preserve unknown tag payloads when editing profiles.
`readIccRgbTransform` interprets RGB matrix/TRC display profiles, including curve tables and
parametric types 0–4. Matrices map to the D50 PCS; `chad` has already been applied to colorants.
`readIccCicp` reads HDR colour identification independently of legacy LUT tags.

This is an initial ICC implementation, not a complete colour management system. LUT transforms,
CMYK and gray profiles are unsupported. Callers must handle an undefined transform explicitly.
Writing rebuilds offsets/alignment and clears the old profile ID; it does not compute an MD5 ID.

`createSrgbIccProfile()` returns an independent copy of the reference Google 2016 sRGB
profile used by hdrify's Ultra HDR writer. `readIccAdgcGuid(readIccProfile(bytes))` reads
the 16-byte Adobe gain-map GUID, returning `undefined` if the ADGC tag is missing or
truncated. Parse raw bytes first to validate the ICC header and tag bounds. JPEG APP2
framing and multipart chunk assembly remain in hdrify's JPEG codec.

## Profile data editing

Binary I/O supports ICC v2/v4 profiles regardless of device color space or tag type.
CMYK, gray, multichannel, LUT, and private tags are retained as opaque bytes; data I/O
does not imply support for their color transforms. No image pixels are transformed by
these data APIs.

```ts
import { readIccProfile, readIccHeader, writeIccHeader, setIccTag, writeIccProfile } from 'hdrify-icc';

const profile = readIccProfile(bytes);
const header = readIccHeader(profile.header);
header.creator = 'demo';
profile.header = writeIccHeader(header);
setIccTag(profile, 'priv', privateTagBytes);
const editedBytes = writeIccProfile(profile);
```

`readIccHeader` / `writeIccHeader` expose every header field, including raw version,
64-bit device attributes, the profile ID, and reserved bytes. Header signatures are
uninterpreted four-byte strings; creation dates are six unsigned 16-bit components.
`getIccTag` returns the first matching tag for direct editing. `setIccTag` replaces the
first match or appends a tag, copying its payload and preserving any later duplicate
signatures. `removeIccTags` removes every match and returns the number removed.

The profile writer preserves tag order and payloads, but recomputes offsets, lengths,
and four-byte alignment. It clears the stale profile ID rather than claiming an edited
profile still has the old checksum. Exact whole-file byte identity (padding, tag layout,
and profile ID) is not promised; opaque metadata is preserved.
