import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { creditLabelWidth, detailWordmarkSize, mergeTitleDetails } from '../lib/detail-presentation.ts';

test('detail metadata preserves real summary fields omitted by the provider, but prefers fresher detail values', () => {
  const summary = { id: 'tt1', name: 'Title', type: 'movie', year: 2025, imdbRating: '7.5', released: '2025-06-27' };
  const detail = { id: 'tt1', name: 'Title', type: 'movie', imdbRating: '7.8', year: undefined, released: undefined, runtime: '110 min' };
  assert.deepEqual(mergeTitleDetails(summary, detail), { ...summary, imdbRating: '7.8', runtime: '110 min' });
  assert.equal(mergeTitleDetails(summary, { ...detail, id: 'tt2' }).id, 'tt2');
  assert.equal(mergeTitleDetails(undefined, detail), detail);
  assert.equal(mergeTitleDetails(summary), summary);
});

test('wordmarks fit the phone and tablet width, keep a bounded height, and never stretch the artwork', () => {
  const narrow = detailWordmarkSize(288, false, 6);
  assert.ok(narrow.width < 288);
  assert.equal(narrow.height, narrow.width / 6);
  assert.equal(detailWordmarkSize(380, false, 800 / 310).height, 92);
  assert.equal(detailWordmarkSize(1000, true, 1).height, 108);
  assert.equal(detailWordmarkSize(1000, true, Infinity).width, 400);
});

test('credit rows share a compact label width that scales with text size', () => {
  assert.equal(creditLabelWidth(false, 1), 48);
  assert.equal(creditLabelWidth(true, 1), 56);
  assert.equal(creditLabelWidth(false, 2), 96);
});

test('native IMDb badge uses the exact vector shape and colors as the web artwork', () => {
  const badge = readFileSync(new URL('../components/details/media-rating-badge.tsx', import.meta.url), 'utf8');
  for (const theme of ['black', 'gold']) {
    const asset = readFileSync(new URL(`../../public/logo/imdb-${theme}.svg`, import.meta.url), 'utf8');
    const vector = asset.match(/id="IMDb_Logo" class="st1" d="([^"]+)"/)?.[1];
    const color = asset.match(/\.st1\s*\{\s*fill:\s*(#[\da-f]+);/)?.[1];
    assert.ok(vector && badge.includes(vector));
    assert.ok(color && badge.includes(color));
  }
});
