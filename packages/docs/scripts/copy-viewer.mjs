import { copyFileSync, mkdirSync } from 'node:fs';

// The live <image-viewer> on the docs page loads the workspace's standalone bundle and a sample image from
// static/viewer, so it shows the code in this checkout rather than the latest npm release.
const out = new URL('../static/viewer/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const file of ['image-viewer.js', 'image-viewer.js.map'])
  copyFileSync(new URL(`../../hdrify-react/dist/${file}`, import.meta.url), new URL(file, out));
copyFileSync(new URL('../../../assets/memorial.exr', import.meta.url), new URL('memorial.exr', out));

copyFileSync(new URL('../../../assets/jxl/vardct_float.jxl', import.meta.url), new URL('vardct_float.jxl', out));
copyFileSync(new URL('../../../assets/memorial.jxl', import.meta.url), new URL('memorial.jxl', out));
