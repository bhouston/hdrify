# hdrify-icc

Read, edit, and write ICC v2/v4 profile data in pure TypeScript, in browsers and Node.js. Preserve unknown tags without native bindings.

This package handles profile data; applications provide pixel color management.

## Installation

```sh
pnpm add hdrify-icc
```

## Edit a profile

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { readIccProfile, readIccHeader, writeIccHeader, writeIccProfile } from 'hdrify-icc';

const profile = readIccProfile(readFileSync('input.icc'));
const header = readIccHeader(profile.header);
header.creator = 'demo';
profile.header = writeIccHeader(header);
writeFileSync('output.icc', writeIccProfile(profile));
```

API reference: [`readIccProfile`](https://hdrify.ben3d.ca/docs/api/icc/functions/readIccProfile/) · [`readIccHeader`](https://hdrify.ben3d.ca/docs/api/icc/functions/readIccHeader/) · [`writeIccHeader`](https://hdrify.ben3d.ca/docs/api/icc/functions/writeIccHeader/) · [`writeIccProfile`](https://hdrify.ben3d.ca/docs/api/icc/functions/writeIccProfile/).

See the [ICC API reference](https://hdrify.ben3d.ca/docs/api/icc/) for tag editing and HDR metadata helpers.

## Contribution

See [Contributing Guide](https://github.com/bhouston/hdrify/blob/main/CONTRIBUTING.md).

## License

MIT

## Author

[Ben Houston](https://ben3d.ca), Sponsored by [Land of Assets](https://landofassets.com).
