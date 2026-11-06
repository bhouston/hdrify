/**
 * Maps links from the old hdrify.ben3d.ca viewer to /demo/. GitHub Pages has no server-side
 * redirects, so this is inlined as a head script and also runs on the 404 page.
 * Must stay self-contained: its source is injected into the page.
 * ponytail: browsers only; a non-browser fetch of an old /examples/ URL still gets a 404.
 */
export function legacyRedirectTarget(href, base) {
  const url = new URL(href);
  const demoPath = (pathname) => `${base}demo/${pathname.slice(base.length)}`;
  if (url.pathname.startsWith(`${base}examples/`)) return `${url.origin}${demoPath(url.pathname)}${url.search}`;

  const image = url.searchParams.get('image');
  if (url.pathname !== base || !image) return null;
  const target = new URL(`${base}demo/`, url.origin);
  target.search = url.search;
  try {
    const source = new URL(image, url.origin);
    if (source.origin === url.origin && source.pathname.startsWith(`${base}examples/`))
      target.searchParams.set('image', demoPath(source.pathname));
  } catch {
    // Leave an unparseable image value for the viewer to report.
  }
  return target.href;
}
