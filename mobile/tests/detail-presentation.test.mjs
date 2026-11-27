import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ratingLabel } from '../lib/home-catalog.ts';
import { creditLabelWidth, detailIdentityGap, detailWordmarkSize, estimateWordmarkPadding, mergeTitleDetails } from '../lib/detail-presentation.ts';

test('detail metadata preserves real summary fields omitted by the provider, but prefers fresher detail values', () => {
  const summary = { id: 'tt1', name: 'Title', type: 'movie', year: 2025, imdbRating: '7.5', released: '2025-06-27' };
  const detail = { id: 'tt1', name: 'Title', type: 'movie', imdbRating: '7.8', year: undefined, released: undefined, runtime: '110 min' };
  assert.deepEqual(mergeTitleDetails(summary, detail), { ...summary, imdbRating: '7.8', runtime: '110 min' });
  assert.equal(mergeTitleDetails(summary, { ...detail, id: 'tt2' }).id, 'tt2');
  assert.equal(mergeTitleDetails(undefined, detail), detail);
  assert.equal(mergeTitleDetails(summary), summary);
  assert.equal(mergeTitleDetails(summary, { ...detail, imdbRating: 'N/A' }).imdbRating, '7.5');
  assert.equal(ratingLabel(mergeTitleDetails(summary, { ...detail, imdbRating: '' })), '7.5');
  assert.equal(ratingLabel({ id: 'tt1', type: 'movie', name: 'Unknown score' }), undefined);
});

test('wordmarks fit the phone and tablet width, keep a bounded height, and never stretch the artwork', () => {
  const narrow = detailWordmarkSize(288, false, 6);
  assert.ok(narrow.width < 288);
  assert.ok(Math.abs(narrow.height - narrow.width / 6) < 1e-9);
  assert.equal(detailWordmarkSize(380, false, 800 / 310).height, 104);
  assert.equal(detailWordmarkSize(1000, true, 1).height, 124);
  assert.equal(detailWordmarkSize(1000, true, Infinity).width, 460);
  assert.equal(detailIdentityGap(false), 18);
  assert.equal(detailIdentityGap(true), 24);
});

test('alpha-profile measurements compensate a padded wide logo but retain the gap for dense artwork', () => {
  // Alpha-only ThumbHash fixtures generated from actual 100px samples of the
  // Guarding Stars, F1, and Pluribus assets. Color coefficients do not matter.
  const guarding = estimateWordmarkPadding('AACAAoAViIiIiIiIiIiIiFdosKljiIc=');
  const f1 = estimateWordmarkPadding('AACAAoAliIiIiIiIiIiIiBdIb3RWOIc=');
  const pluribus = estimateWordmarkPadding('AACAAoAjiIiIiIiIiIiIiHeIiIiAeJc=');
  assert.equal(guarding.bottom, 0);
  assert.equal(f1.bottom, 0);
  assert.ok(pluribus.bottom > 0.18 && pluribus.bottom < 0.28);
  const dense = detailWordmarkSize(380, false, 800 / 310, f1);
  const sparse = detailWordmarkSize(380, false, 800 / 310, pluribus);
  assert.equal(dense.bottomOffset, 0);
  assert.ok(sparse.width > dense.width);
  assert.ok(sparse.height <= 136 && sparse.width <= 360);
  assert.ok(sparse.bottomOffset > 20 && sparse.bottomOffset <= 36);
  // Actual Pluribus lower margin is 84/310; the new layout still gives it
  // clearance for soft edges after accounting for transparent canvas pixels.
  assert.ok(detailIdentityGap(false) + 84 / 310 * sparse.height - sparse.bottomOffset < 28);
});

test('missing or malformed alpha samples preserve the ordinary title gap', () => {
  for (const hash of [undefined, '', '!invalid', 'AACAAoAj', 'AAAAAAA=', 'A'.repeat(65)]) {
    assert.deepEqual(estimateWordmarkPadding(hash), { top: 0, bottom: 0 });
  }
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
