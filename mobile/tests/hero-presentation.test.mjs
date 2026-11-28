import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heroLayout, heroMetadataParts } from '../lib/hero-presentation.ts';

test('hero metadata is one concise discovery summary, not a detail fact list', () => {
  assert.deepEqual(heroMetadataParts({ id: 'tt1', type: 'movie', name: 'Film', genres: ['Action', 'Drama', 'Adventure'], contentRating: 'PG-13', year: 2025, runtime: '156 min', imdbRating: '7.6' }), ['Movie', 'Action', 'Drama', 'PG-13']);
  assert.deepEqual(heroMetadataParts({ id: 'tt2', type: 'series', name: 'Series', genres: ['Drama', 'Drama', 'Sci-Fi'] }), ['TV show', 'Drama', 'Sci-Fi']);
  assert.deepEqual(heroMetadataParts({ id: 'tt3', type: 'movie', name: 'Film', genres: [' ', 'Comedy'], contentRating: ' ' }), ['Movie', 'Comedy']);
  assert.deepEqual(heroMetadataParts({ id: 'tt4', type: 'series', name: 'Series' }), ['TV show']);
});

test('compact phones and narrow tablet split views keep the centered hero', () => {
  const phone = heroLayout(402, 874, 0, 0);
  assert.equal(phone.roomy, false);
  assert.equal(phone.leadingPadding, 16);
  assert.equal(phone.trailingPadding, 16);
  assert.equal(heroLayout(744, 1133, 0, 0).roomy, false);
  assert.equal(heroLayout(800, 800, 32, 24).roomy, false);
});

test('roomy tablet hero reserves a leading copy column and a wide artwork area', () => {
  const portrait = heroLayout(834, 1194, 0, 0);
  assert.equal(portrait.roomy, true);
  assert.equal(portrait.leadingPadding, 32);
  assert.equal(portrait.copyWidth, 417);
  const landscape = heroLayout(1194, 834, 10, 10);
  assert.equal(landscape.roomy, true);
  assert.equal(landscape.leadingPadding, 42);
  assert.equal(landscape.trailingPadding, 42);
  assert.equal(landscape.copyWidth, 460);
  assert.ok(landscape.copyWidth < 1194 / 2);
});

test('hero keeps the View and visible carousel gaps balanced, and grows the logo on tablets', () => {
  const phone = heroLayout(360, 780, 0, 0);
  const tablet = heroLayout(1024, 768, 0, 0);
  // The carousel's visible pill starts 6 points below its touch area.
  for (const layout of [phone, tablet]) {
    assert.equal(layout.actionGap, layout.controlsGap + 6);
    assert.ok(layout.wordmarkWidth <= layout.copyWidth);
    assert.ok(layout.bottomGap >= 16);
  }
  assert.ok(tablet.wordmarkHeight > phone.wordmarkHeight);
  assert.ok(tablet.identityGap > phone.identityGap);
});
