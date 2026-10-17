import { cp, access } from 'node:fs/promises';
const demo = new URL('../../website/dist/', import.meta.url);
await access(new URL('index.html', demo));
await cp(demo, new URL('../build/demo/', import.meta.url), { recursive: true });
console.log('Included static viewer and examples at /demo/');
