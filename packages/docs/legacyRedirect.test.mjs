import { describe, expect, it } from 'vitest';
import { legacyRedirectTarget } from './legacyRedirect.mjs';

const site = 'https://hdrify.ben3d.ca';

describe('legacyRedirectTarget', () => {
  it('sends old example files to the demo', () => {
    expect(legacyRedirectTarget(`${site}/examples/memorial.hdr`, '/')).toBe(`${site}/demo/examples/memorial.hdr`);
  });

  it('opens old image links in the viewer and rewrites old example paths', () => {
    const target = new URL(legacyRedirectTarget(`${site}/?image=/examples/memorial.hdr`, '/'));
    expect(target.pathname).toBe('/demo/');
    expect(target.searchParams.get('image')).toBe('/demo/examples/memorial.hdr');
  });

  it('rewrites absolute old example URLs', () => {
    const target = new URL(legacyRedirectTarget(`${site}/?image=${site}/examples/a.exr`, '/'));
    expect(target.searchParams.get('image')).toBe('/demo/examples/a.exr');
  });

  it('keeps external images and other parameters', () => {
    const target = new URL(legacyRedirectTarget(`${site}/?image=https://example.com/a.hdr&exposure=2`, '/'));
    expect(target.pathname).toBe('/demo/');
    expect(target.searchParams.get('image')).toBe('https://example.com/a.hdr');
    expect(target.searchParams.get('exposure')).toBe('2');
  });

  it('respects a non-root base URL', () => {
    expect(legacyRedirectTarget('https://example.com/hdrify/examples/a.hdr', '/hdrify/')).toBe(
      'https://example.com/hdrify/demo/examples/a.hdr',
    );
  });

  it('leaves every other page alone', () => {
    for (const path of ['/', '/docs/', '/demo/?image=/demo/examples/a.hdr', '/docs/?image=/examples/a.hdr'])
      expect(legacyRedirectTarget(`${site}${path}`, '/')).toBeNull();
  });
});
