# hdrify-icc

Pure TypeScript ICC v2/v4 profile data reader and writer for browsers and Node.js.
`readIccProfile` and `writeIccProfile` preserve all tag payloads, including LUTs,
CMYK, gray, and unknown/private tags. Reading and writing a profile does not
require support for its color transform. `readIccCicp` reads HDR identification data.

This package does not evaluate curves, transform pixels, or modify image data.
Image consumers are responsible for interpreting profile data and applying color
management. The existing JPEG XL color conversion remains in `hdrify`.

Writing rebuilds offsets/alignment and clears the old profile ID; it does not
compute an MD5 ID. Keep the original bytes when byte-exact profile transport is needed.

## Migration

The executable `readIccCurve` and `readIccRgbTransform` helpers and their
`IccCurve`/`IccRgbTransform` types have moved into hdrify's internal color module.
They are no longer exported by hdrify-icc. Consumers needing transforms should
use their own color-management implementation with the parsed profile data.

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
