import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination } from './redirect-server.mjs';

void test('legacy homepage redirects to the documentation', () => {
  assert.equal(destination('/'), 'https://bhouston.github.io/hdrify/');
});
void test('legacy image links keep the selected example on the live demo', () => {
  const target = new URL(destination('/?image=/examples/memorial.hdr'));
  assert.equal(target.pathname, '/hdrify/demo/');
  assert.equal(target.searchParams.get('image'), 'https://bhouston.github.io/hdrify/demo/examples/memorial.hdr');
});
void test('absolute legacy examples and external images remain usable', () => {
  const legacy = new URL(destination('/?image=https://hdrify.ben3d.ca/examples/memorial.exr'));
  assert.equal(legacy.searchParams.get('image'), 'https://bhouston.github.io/hdrify/demo/examples/memorial.exr');
  const external = new URL(destination('/?image=https://example.com/photo.exr'));
  assert.equal(external.searchParams.get('image'), 'https://example.com/photo.exr');
});
void test('legacy example asset URLs resolve to the copied demo assets', () => {
  assert.equal(destination('/examples/memorial.hdr'), 'https://bhouston.github.io/hdrify/demo/examples/memorial.hdr');
});

void test('malformed shared URLs cannot crash the redirect service', () => {
  assert.equal(new URL(destination('/?image=http://[')).searchParams.get('image'), 'http://[');
});
