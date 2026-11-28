import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artworkBlurLayers, createArtworkLoadTracker, lightArtworkTopScrim } from '../lib/progressive-artwork.ts';

test('light mode scrim protects the status area and fades shortly below it', () => {
  for (const inset of [0, 24, 59, 62]) {
    for (const artworkHeight of [288, 400, 520]) {
      const { height, colors, locations } = lightArtworkTopScrim(inset, artworkHeight);
      const protectedHeight = Math.max(24, inset);
      assert.equal(height, protectedHeight + 72);
      assert.ok(Math.abs(locations[1] * artworkHeight - protectedHeight) < 0.001);
      assert.equal(colors[1], 'rgba(255,255,255,0.60)');
      assert.equal(colors[3], 'rgba(255,255,255,0)');
      assert.equal(colors[4], colors[3]);
      assert.ok(Math.abs(locations[3] * artworkHeight - height) < 0.001);
      assert.ok(locations[3] < locations[4]);
      assert.equal(locations[4], 1);
    }
  }
  // Worst case: a black image beneath the 60% white scrim. Compare with
  // near-black (#191919) status text using the sRGB luminance formula.
  const luminance = value => ((value + 0.055) / 1.055) ** 2.4;
  assert.ok((luminance(0.60) + 0.05) / (luminance(25 / 255) + 0.05) >= 4.5);
});

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
