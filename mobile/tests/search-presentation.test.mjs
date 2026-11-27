import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchGridLayout, searchPhase, searchPresentation } from '../lib/search-presentation.ts';

const titles = [
  { id: 'tt1', name: 'First movie', type: 'movie' },
  { id: 'tt2', name: 'TV show', type: 'series' },
  { id: 'tt3', name: 'Second movie', type: 'movie' },
];

test('grid fills the available content width at phone, tablet and split-view sizes', () => {
  for (const width of [320, 375, 430, 640, 768, 834, 1024, 1366]) {
    const { gutter, columns, cardWidth, columnGap } = searchGridLayout(width);
    assert.equal(columns >= 2, true);
    assert.ok(cardWidth >= (width >= 1024 ? 144 : width >= 640 ? 136 : 100));
    assert.ok(Math.abs(2 * gutter + columns * cardWidth + (columns - 1) * columnGap - width) < 0.00001);
  }
  assert.equal(searchGridLayout(320).columns, 2);
  assert.equal(searchGridLayout(360).columns, 3);
  assert.equal(searchGridLayout(375).columns, 3);
  assert.equal(searchGridLayout(430).columns, 3);
  assert.equal(searchGridLayout(768).columns, 4);
  assert.equal(searchGridLayout(1024).columns, 6);
});

test('larger text uses fewer columns without overflowing narrow screens', () => {
  assert.equal(searchGridLayout(360, 1.2).columns, 2);
  assert.equal(searchGridLayout(320, 2).columns, 1);
  assert.equal(searchGridLayout(768, 2).columns, 3);
  const { gutter, columns, cardWidth, columnGap } = searchGridLayout(320, 2);
  assert.equal(2 * gutter + columns * cardWidth + (columns - 1) * columnGap, 320);
});

test('result filters preserve provider order and count returned media types', () => {
  assert.deepEqual(searchPresentation(titles, 'movie'), { counts: { all: 3, movie: 2, series: 1 }, items: [titles[0], titles[2]] });
  assert.deepEqual(searchPresentation(titles, 'series').items, [titles[1]]);
  assert.deepEqual(searchPresentation(titles, 'all').items, titles);
  assert.deepEqual(searchPresentation([], 'all'), { counts: { all: 0, movie: 0, series: 0 }, items: [] });
});

test('editing and clearing hide stale results and do not show false empty states', () => {
  assert.equal(searchPhase('', 'Star Wars', false, false, 4, 4), 'idle');
  assert.equal(searchPhase('   ', 'Star Wars', false, false, 4, 4), 'idle');
  assert.equal(searchPhase('Star Trek', 'Star Wars', false, false, 4, 4), 'loading');
  assert.equal(searchPhase('Star Trek', 'Star Trek', true, false, 0, 0), 'loading');
  assert.equal(searchPhase(' Star Trek ', 'Star Trek', false, false, 4, 4), 'results');
});

test('empty, filtered, network error and cached success states are distinct', () => {
  assert.equal(searchPhase('Star Trek', 'Star Trek', false, true, 0, 0), 'error');
  assert.equal(searchPhase('Star Trek', 'Star Trek', false, false, 0, 0), 'empty');
  assert.equal(searchPhase('Star Trek', 'Star Trek', false, false, 4, 0), 'filtered-empty');
  assert.equal(searchPhase('Star Trek', 'Star Trek', false, true, 4, 4), 'results');
});

test('exact title matches come first without changing the remaining provider order', () => {
  assert.deepEqual(searchPresentation(titles, 'all', ' tv SHOW ').items, [titles[1], titles[0], titles[2]]);
  assert.deepEqual(searchPresentation(titles, 'movie', 'tv show').items, [titles[0], titles[2]]);
  assert.deepEqual(searchPresentation(titles, 'all', 'second').items, titles);
  assert.deepEqual(searchPresentation(titles, 'all', 'Ｓｅｃｏｎｄ ｍｏｖｉｅ').items, [titles[2], titles[0], titles[1]]);
});
