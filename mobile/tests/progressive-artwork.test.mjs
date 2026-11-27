import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artworkBlurLayers, createArtworkLoadTracker } from '../lib/progressive-artwork.ts';

test('carousel keeps a compact, progressive mask stack on both platforms', () => {
  const ios = artworkBlurLayers('carousel', 'ios');
  const android = artworkBlurLayers('carousel', 'android');
  assert.equal(ios, android);
  assert.equal(ios.length, 2);
  assert.ok(ios[0].radius < ios[1].radius);
  assert.ok(ios[0].start < ios[1].start);
  assert.ok(ios[0].end < ios[1].end);
  assert.equal(artworkBlurLayers('full', 'ios').length, 3);
  assert.equal(artworkBlurLayers('full', 'android').length, 2);
});

test('the sharp backdrop alone cannot reveal the composed artwork', () => {
  const markReady = createArtworkLoadTracker(3);
  assert.equal(markReady(0), false);
  assert.equal(markReady(0), false);
  assert.equal(markReady(2), false);
  assert.equal(markReady(3), false);
  assert.equal(markReady(1), true);
  assert.equal(markReady(1), false);
  assert.equal(markReady(2), false);
});
