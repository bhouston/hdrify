import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function destination(requestUrl) {
  const incoming = new URL(requestUrl, 'https://hdrify.ben3d.ca');
  const target = new URL('https://bhouston.github.io/hdrify/');
  // Old image URLs can point at /examples/*.hdr on the former homepage.
  // Assets still ship with the demo, so rewrite only that legacy origin.
  const image = incoming.searchParams.get('image');
  if (incoming.pathname.startsWith('/examples/')) {
    target.pathname += `demo${incoming.pathname}`;
  } else if (image || incoming.pathname.startsWith('/demo')) {
    target.pathname += 'demo/';
  } else if (incoming.pathname.startsWith('/docs/')) {
    target.pathname += incoming.pathname.slice(1);
  }
  target.search = incoming.search;
  if (image) {
    let source;
    try {
      source = new URL(image, 'https://hdrify.ben3d.ca');
    } catch {
      return target.href;
    }
    if (source.origin === 'https://hdrify.ben3d.ca' && source.pathname.startsWith('/examples/')) {
      target.searchParams.set('image', `https://bhouston.github.io/hdrify/demo${source.pathname}`);
    }
  }
  return target.href;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer((req, res) => {
    res.writeHead(308, { Location: destination(req.url ?? '/'), 'Cache-Control': 'public, max-age=300' });
    res.end();
  }).listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
}
